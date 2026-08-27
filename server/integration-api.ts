import { timingSafeEqual } from "node:crypto";
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { integrationEvents, serverInstances, serverStatusSnapshots } from "../drizzle/schema";
import { appendAuditLog, createMinecraftLinkCode, getDb, getDiscordDelivery, getDiscordLinkedPlayer, getDiscordPermissionPolicies, getIntegrationCommandStatus, getLatestServerStatus, getPendingDiscordDeliveries, getPendingIntegrationCommands, getPendingRoleSyncs, getPublicPlayerProfile, getRecentMinecraftEvents, ingestPlayerStatsSnapshot, markIntegrationCommandResult, recordDiscordDelivery, recordPlayerActivity, redeemDiscordLinkCode, revokeLinkCode, unlinkDiscordAccount, upsertMinecraftPlayer } from "./db";

const integrationEventSchema = z.object({
  id: z.string().min(8).max(64),
  idempotencyKey: z.string().min(8).max(128),
  type: z.string().min(3).max(96),
  origin: z.enum(["minecraft", "discord", "backend", "web"]),
  version: z.literal(1),
  correlationId: z.string().max(64).optional(),
  occurredAt: z.string().datetime(),
  payload: z.record(z.string(), z.unknown()),
});

function getProvidedIntegrationKey(req: Request) {
  const header = req.header("x-integration-key");
  if (header) return header;
  const authorization = req.header("authorization");
  if (authorization?.startsWith("Bearer ")) return authorization.slice(7);
  return "";
}

export function hasValidIntegrationKey(provided: string, expected = process.env.INTEGRATION_API_KEY ?? "") {
  if (!provided || !expected) return false;
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  if (providedBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(providedBuffer, expectedBuffer);
}

export function integrationHealthHandler(req: Request, res: Response) {
  if (!hasValidIntegrationKey(getProvidedIntegrationKey(req))) {
    return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
  }

  return res.status(200).json({
    ok: true,
    service: "minecraft-discord-platform",
    timestamp: new Date().toISOString(),
  });
}

export function registerIntegrationApi(app: Express) {
  app.get("/api/integration/health", integrationHealthHandler);

  app.get("/api/integration/discord-feed", async (req, res) => {
    if (!hasValidIntegrationKey(getProvidedIntegrationKey(req))) return res.status(401).json({ events: [], error: "UNAUTHORIZED" });
    const limit = z.coerce.number().int().min(1).max(50).default(25).parse(req.query.limit ?? 25);
    const channelId = z.string().min(2).max(32).parse(req.query.channelId);
    const events = await getRecentMinecraftEvents(limit);
    const syncTypes = ["player.joined", "player.stats.snapshot"];
    const bridgeTypes = ["player.joined", "player.left", "chat.minecraft"];
    const allowedTypes = channelId === "system" ? syncTypes : bridgeTypes;
    
    const withDelivery = await Promise.all(events.filter(event => allowedTypes.includes(event.type)).map(async event => ({ ...event, delivery: await getDiscordDelivery(event.id, channelId) })));
    return res.status(200).json({ events: withDelivery });
  });

  app.get("/api/integration/discord-feed/pending", async (req, res) => {
    if (!hasValidIntegrationKey(getProvidedIntegrationKey(req))) return res.status(401).json({ events: [], error: "UNAUTHORIZED" });
    const channelId = z.string().min(2).max(32).parse(req.query.channelId);
    const pending = await getPendingDiscordDeliveries(channelId);
    return res.status(200).json({ events: pending.map(item => ({ ...item.event, delivery: item.delivery })) });
  });

  app.get("/api/integration/discord-roles/pending", async (req, res) => {
    if (!hasValidIntegrationKey(getProvidedIntegrationKey(req))) return res.status(401).json({ events: [], error: "UNAUTHORIZED" });
    const events = await getPendingRoleSyncs();
    return res.status(200).json({ events });
  });

  app.post("/api/integration/discord-feed/delivery", async (req, res) => {
    if (!hasValidIntegrationKey(getProvidedIntegrationKey(req))) return res.status(401).json({ accepted: false, error: "UNAUTHORIZED" });
    const input = z.object({ eventId: z.string().min(8).max(64), eventType: z.string().min(3).max(96), channelId: z.string().min(2).max(32), success: z.boolean(), error: z.string().max(255).optional() }).safeParse(req.body);
    if (!input.success) return res.status(400).json({ accepted: false, error: "INVALID_DELIVERY" });
    const delivery = await recordDiscordDelivery(input.data);
    return res.status(200).json({ accepted: true, delivery });
  });

  app.get("/api/integration/server-status", async (req, res) => {
    if (!hasValidIntegrationKey(getProvidedIntegrationKey(req))) return res.status(401).json({ error: "UNAUTHORIZED" });
    const serverKey = String(req.query.serverKey ?? "primary");
    const status = await getLatestServerStatus(serverKey);
    return res.status(200).json(status ?? { online: false, snapshot: null });
  });

  app.get("/api/integration/player", async (req, res) => {
    if (!hasValidIntegrationKey(getProvidedIntegrationKey(req))) return res.status(401).json({ error: "UNAUTHORIZED" });
    const username = String(req.query.username ?? "").trim();
    if (!username || username.length > 16) return res.status(400).json({ error: "INVALID_USERNAME" });
    const profile = await getPublicPlayerProfile(username);
    return profile ? res.status(200).json(profile) : res.status(404).json({ error: "PLAYER_NOT_FOUND" });
  });

  app.post("/api/integration/link-codes", async (req, res) => {
    if (!hasValidIntegrationKey(getProvidedIntegrationKey(req))) {
      return res.status(401).json({ created: false, error: "UNAUTHORIZED" });
    }
    const input = z.object({
      uuid: z.string().uuid(),
      username: z.string().min(1).max(16),
      target: z.enum(["discord", "site"]),
    }).safeParse(req.body);
    if (!input.success) return res.status(400).json({ created: false, error: "INVALID_LINK_REQUEST" });
    try {
      const result = await createMinecraftLinkCode(input.data);
      return res.status(201).json({ created: true, code: result.code, expiresAt: result.expiresAt.toISOString() });
    } catch (error) {
      console.error("[Integration] Could not create link code", error);
      return res.status(503).json({ created: false, error: "DATABASE_UNAVAILABLE" });
    }
  });

  app.post("/api/integration/link-codes/redeem-discord", async (req, res) => {
    if (!hasValidIntegrationKey(getProvidedIntegrationKey(req))) return res.status(401).json({ linked: false, error: "UNAUTHORIZED" });
    const input = z.object({ code: z.string().regex(/^\d{6}$/), discordUserId: z.string().min(2).max(32), username: z.string().min(1).max(128), globalName: z.string().max(128).nullable().optional() }).safeParse(req.body);
    if (!input.success) return res.status(400).json({ linked: false, error: "INVALID_LINK_REQUEST" });
    try {
      const result = await redeemDiscordLinkCode(input.data);
      await appendAuditLog({ actorType: "discord_user", actorId: input.data.discordUserId, action: "account.link.redeem.discord", resourceType: "minecraft_player", resourceId: String(result.minecraftPlayerId), outcome: "succeeded" });
      return res.status(200).json({ linked: true, ...result });
    } catch (error) {
      const message = error instanceof Error ? error.message : "LINK_FAILED";
      try { await appendAuditLog({ actorType: "discord_user", actorId: input.data.discordUserId, action: "account.link.redeem.discord", resourceType: "link_code", outcome: "failed", metadata: { reason: message } }); } catch { /* auditoria não oculta falha de domínio */ }
      return res.status(message === "PLAYER_ALREADY_LINKED" ? 409 : 400).json({ linked: false, error: message });
    }
  });

  app.post("/api/integration/link-codes/revoke", async (req, res) => {
    if (!hasValidIntegrationKey(getProvidedIntegrationKey(req))) return res.status(401).json({ revoked: false, error: "UNAUTHORIZED" });
    const input = z.object({ code: z.string().regex(/^\d{6}$/) }).safeParse(req.body);
    if (!input.success) return res.status(400).json({ revoked: false, error: "INVALID_CODE" });
    const revoked = await revokeLinkCode(input.data.code);
    await appendAuditLog({ actorType: "system", actorId: "integration-api", action: "link_code.revoke", resourceType: "link_code", outcome: revoked ? "succeeded" : "failed" });
    return res.status(200).json({ revoked });
  });

  app.get("/api/integration/discord-permissions", async (req, res) => {
    if (!hasValidIntegrationKey(getProvidedIntegrationKey(req))) return res.status(401).json({ policies: [], error: "UNAUTHORIZED" });
    const guildId = z.string().min(2).max(32).parse(req.query.guildId);
    const policies = await getDiscordPermissionPolicies(guildId);
    return res.status(200).json({ policies });
  });

  app.get("/api/integration/discord-profile", async (req, res) => {
    if (!hasValidIntegrationKey(getProvidedIntegrationKey(req))) return res.status(401).json({ profile: null, error: "UNAUTHORIZED" });
    const discordUserId = z.string().min(2).max(32).parse(req.query.discordUserId);
    const profile = await getDiscordLinkedPlayer(discordUserId);
    return res.status(200).json({ profile: profile ?? null });
  });

  app.post("/api/integration/unlink-discord", async (req, res) => {
    if (!hasValidIntegrationKey(getProvidedIntegrationKey(req))) return res.status(401).json({ unlinked: false, error: "UNAUTHORIZED" });
    const input = z.object({ discordUserId: z.string().min(2).max(32) }).safeParse(req.body);
    if (!input.success) return res.status(400).json({ unlinked: false, error: "INVALID_ACCOUNT" });
    const unlinked = await unlinkDiscordAccount(input.data.discordUserId);
    await appendAuditLog({ actorType: "discord_user", actorId: input.data.discordUserId, action: "account.unlink.discord", resourceType: "account_link", outcome: unlinked ? "succeeded" : "failed" });
    return res.status(200).json({ unlinked });
  });

  app.get("/api/integration/admin/commands/pending", async (req, res) => {
    if (!hasValidIntegrationKey(getProvidedIntegrationKey(req))) return res.status(401).json({ commands: [], error: "UNAUTHORIZED" });
    const serverKey = z.string().min(1).max(64).parse(req.query.serverKey ?? "primary");
    const commands = await getPendingIntegrationCommands(serverKey);
    return res.status(200).json({ commands });
  });

  app.get("/api/integration/admin/commands/status", async (req, res) => {
    if (!hasValidIntegrationKey(getProvidedIntegrationKey(req))) return res.status(401).json({ status: "unknown", error: "UNAUTHORIZED" });
    const commandId = z.string().uuid().parse(req.query.commandId);
    const status = await getIntegrationCommandStatus(commandId);
    return res.status(200).json(status ?? { status: "unknown" });
  });

  app.post("/api/integration/admin/commands/result", async (req, res) => {
    if (!hasValidIntegrationKey(getProvidedIntegrationKey(req))) return res.status(401).json({ accepted: false, error: "UNAUTHORIZED" });
    const input = z.object({ eventId: z.string().uuid(), success: z.boolean(), message: z.string().max(255).optional() }).safeParse(req.body);
    if (!input.success) return res.status(400).json({ accepted: false, error: "INVALID_COMMAND_RESULT" });
    await markIntegrationCommandResult(input.data.eventId, input.data.success, input.data.message);
    await appendAuditLog({ actorType: "system", actorId: "minecraft-plugin", action: "admin.command.result", resourceType: "minecraft_command", resourceId: input.data.eventId, outcome: input.data.success ? "succeeded" : "failed", correlationId: input.data.eventId, metadata: { message: input.data.message } });
    return res.status(200).json({ accepted: true });
  });

  app.post("/api/integration/chat/discord", async (req, res) => {
    if (!hasValidIntegrationKey(getProvidedIntegrationKey(req))) return res.status(401).json({ accepted: false, error: "UNAUTHORIZED" });
    const input = z.object({ messageId: z.string().min(2).max(64), authorId: z.string().min(2).max(64), guildId: z.string().min(2).max(64), serverKey: z.string().min(1).max(64).default("primary"), message: z.string().min(1).max(255), bridgeOrigin: z.literal("discord") }).safeParse(req.body);
    if (!input.success) return res.status(400).json({ accepted: false, error: "INVALID_CHAT_MESSAGE" });
    const db = await getDb();
    if (!db) return res.status(503).json({ accepted: false, error: "DATABASE_UNAVAILABLE" });
    const event = { id: crypto.randomUUID(), idempotencyKey: `chat-discord:${input.data.messageId}`, type: "chat.discord", origin: "discord" as const, version: 1, correlationId: input.data.messageId, status: "received" as const, payload: input.data };
    try { await db.insert(integrationEvents).values(event); } catch (error) {
      if (String(error).includes("Duplicate")) return res.status(200).json({ accepted: true, deduplicated: true, messageId: input.data.messageId });
      throw error;
    }
    await appendAuditLog({ actorType: "discord_user", actorId: input.data.authorId, action: "bridge.chat.discord", resourceType: "chat_message", resourceId: input.data.messageId, outcome: "allowed", correlationId: input.data.messageId, metadata: { guildId: input.data.guildId, serverKey: input.data.serverKey, bridgeOrigin: input.data.bridgeOrigin } });
    return res.status(202).json({ accepted: true, deduplicated: false, messageId: input.data.messageId });
  });

  app.post("/api/integration/admin/commands", async (req, res) => {
    if (!hasValidIntegrationKey(getProvidedIntegrationKey(req))) return res.status(401).json({ accepted: false, error: "UNAUTHORIZED" });
    const input = z.object({ commandId: z.string().min(8).max(64), action: z.enum(["say", "broadcast", "kick", "whitelist.add", "whitelist.remove"]), serverKey: z.string().min(1).max(64).default("primary"), actorId: z.string().min(2).max(64), guildId: z.string().min(2).max(64), roleIds: z.array(z.string().min(2).max(64)).max(50), parameters: z.record(z.string(), z.string()).default({}) }).safeParse(req.body);
    if (!input.success) return res.status(400).json({ accepted: false, error: "INVALID_COMMAND" });
    const db = await getDb();
    if (!db) return res.status(503).json({ accepted: false, error: "DATABASE_UNAVAILABLE" });
    const event = { id: crypto.randomUUID(), idempotencyKey: `discord-command:${input.data.commandId}`, type: "admin.command.requested", origin: "discord" as const, version: 1, correlationId: input.data.commandId, status: "received" as const, payload: input.data };
    try {
      await db.insert(integrationEvents).values(event);
    } catch (error) {
      if (String(error).includes("Duplicate")) return res.status(200).json({ accepted: true, deduplicated: true, commandId: input.data.commandId });
      throw error;
    }
    await appendAuditLog({ actorType: "discord_user", actorId: input.data.actorId, action: `admin.command.${input.data.action}`, resourceType: "minecraft_command", resourceId: input.data.commandId, outcome: "allowed", correlationId: input.data.commandId, metadata: { guildId: input.data.guildId, roleIds: input.data.roleIds, serverKey: input.data.serverKey } });
    return res.status(202).json({ accepted: true, deduplicated: false, commandId: input.data.commandId });
  });

  app.post("/api/integration/events", async (req, res) => {
    if (!hasValidIntegrationKey(getProvidedIntegrationKey(req))) {
      return res.status(401).json({ accepted: false, error: "UNAUTHORIZED" });
    }

    const parsed = integrationEventSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ accepted: false, error: "INVALID_EVENT" });
    }

    const db = await getDb();
    if (!db) {
      return res.status(503).json({ accepted: false, error: "DATABASE_UNAVAILABLE" });
    }

    const event = parsed.data;
    const existing = await db
      .select({ id: integrationEvents.id })
      .from(integrationEvents)
      .where(eq(integrationEvents.idempotencyKey, event.idempotencyKey))
      .limit(1);

    if (existing.length > 0) {
      return res.status(200).json({ accepted: true, deduplicated: true, eventId: existing[0]?.id });
    }

    let processed = false;
    if (["player.joined", "player.left", "chat.minecraft"].includes(event.type)) {
      const activity = z.object({ uuid: z.string().uuid(), username: z.string().min(1).max(16), rank: z.string().optional(), message: z.string().max(255).optional() }).safeParse(event.payload);
      if (activity.success) {
        if (event.type === "player.joined" && activity.data.rank) {
          await upsertMinecraftPlayer({ uuid: activity.data.uuid, username: activity.data.username, rank: activity.data.rank });
        }
        await recordPlayerActivity({ uuid: activity.data.uuid, username: activity.data.username, type: event.type, summary: activity.data.message ?? (event.type === "player.joined" ? `${activity.data.username} entrou no servidor` : event.type === "player.left" ? `${activity.data.username} saiu do servidor` : `${activity.data.username} enviou uma mensagem`) });
        processed = true;
      }
    }
    if (event.type === "player.stats.snapshot") {
      const stats = z.object({ uuid: z.string().uuid(), username: z.string().min(1).max(16), rank: z.string().optional(), playtimeSeconds: z.number().int().min(0), blocksBroken: z.number().int().min(0).optional(), blocksPlaced: z.number().int().min(0).optional(), kills: z.number().int().min(0).optional(), deaths: z.number().int().min(0).optional(), achievementsCount: z.number().int().min(0).optional() }).safeParse(event.payload);
      if (stats.success) {
        await ingestPlayerStatsSnapshot(stats.data);
        processed = true;
      }
    }
    if (event.type === "server.heartbeat") {
      const heartbeat = z.object({
        serverKey: z.string().min(1).max(64),
        online: z.boolean(),
        playersOnline: z.number().int().min(0),
        playerLimit: z.number().int().min(0),
        tps: z.string().max(12),
        minecraftVersion: z.string().max(64),
        uptimeSeconds: z.number().int().min(0),
      }).safeParse(event.payload);
      if (heartbeat.success) {
        await db.insert(serverInstances).values({ serverKey: heartbeat.data.serverKey, displayName: heartbeat.data.serverKey }).onDuplicateKeyUpdate({ set: { enabled: true } });
        const server = await db.select({ id: serverInstances.id }).from(serverInstances).where(eq(serverInstances.serverKey, heartbeat.data.serverKey)).limit(1);
        if (server[0]) {
          await db.insert(serverStatusSnapshots).values({ serverInstanceId: server[0].id, online: heartbeat.data.online, playersOnline: heartbeat.data.playersOnline, playerLimit: heartbeat.data.playerLimit, tps: heartbeat.data.tps, minecraftVersion: heartbeat.data.minecraftVersion, uptimeSeconds: heartbeat.data.uptimeSeconds });
          processed = true;
        }
      }
    }

    await db.insert(integrationEvents).values({
      id: event.id,
      idempotencyKey: event.idempotencyKey,
      type: event.type,
      origin: event.origin,
      version: event.version,
      correlationId: event.correlationId,
      status: processed ? "processed" : "received",
      payload: event.payload,
      processedAt: processed ? new Date() : null,
    });

    return res.status(202).json({ accepted: true, deduplicated: false, eventId: event.id, processed });
  });
}
