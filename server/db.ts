import { createHash, randomInt } from "node:crypto";
import { and, desc, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser,
  accountLinks,
  auditLogs,
  discordAccounts,
  discordEventDeliveries,
  discordRolePermissions,
  integrationEvents,
  linkCodes,
  minecraftPlayerStats,
  minecraftPlayers,
  playerActivityEvents,
  serverInstances,
  serverStatusSnapshots,
  users,
} from "../drizzle/schema";
import { ENV } from './_core/env';
import { deliveryKey, retryDelayMs } from './bridge-policy';

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

export async function upsertMinecraftPlayer(input: { uuid: string; username: string }) {
  const db = await getDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  await db
    .insert(minecraftPlayers)
    .values({ uuid: input.uuid, username: input.username, lastSeenAt: new Date() })
    .onDuplicateKeyUpdate({ set: { username: input.username, lastSeenAt: new Date() } });
  const rows = await db.select().from(minecraftPlayers).where(eq(minecraftPlayers.uuid, input.uuid)).limit(1);
  if (!rows[0]) throw new Error("PLAYER_NOT_FOUND_AFTER_UPSERT");
  return rows[0];
}

export async function getLatestServerStatus(serverKey = "primary") {
  const db = await getDb();
  if (!db) return undefined;
  const server = await db.select().from(serverInstances).where(eq(serverInstances.serverKey, serverKey)).limit(1);
  if (!server[0]) return undefined;
  const snapshot = await db
    .select()
    .from(serverStatusSnapshots)
    .where(eq(serverStatusSnapshots.serverInstanceId, server[0].id))
    .orderBy(desc(serverStatusSnapshots.receivedAt))
    .limit(1);
  const latest = snapshot[0];
  if (!latest) return { server: server[0], snapshot: undefined, online: false };
  const heartbeatFresh = Date.now() - latest.receivedAt.getTime() < 45_000;
  return { server: server[0], snapshot: latest, online: latest.online && heartbeatFresh };
}

export async function getPublicPlayerProfile(username: string) {
  const db = await getDb();
  if (!db) return undefined;
  const player = await db.select().from(minecraftPlayers).where(eq(minecraftPlayers.username, username)).limit(1);
  if (!player[0]) return undefined;
  const link = await db
    .select({ discordAccountId: accountLinks.discordAccountId, siteUserId: accountLinks.siteUserId, linkedAt: accountLinks.linkedAt })
    .from(accountLinks)
    .where(and(eq(accountLinks.minecraftPlayerId, player[0].id), isNull(accountLinks.unlinkedAt)))
    .limit(1);
  return { player: player[0], link: link[0] };
}

function hashLinkCode(code: string) {
  return createHash("sha256").update(code).digest("hex");
}

export async function createMinecraftLinkCode(input: {
  uuid: string;
  username: string;
  target: "discord" | "site";
  siteUserId?: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  const player = await upsertMinecraftPlayer(input);
  const code = String(randomInt(100000, 1_000_000));
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  await db.insert(linkCodes).values({
    codeHash: hashLinkCode(code),
    target: input.target,
    minecraftPlayerId: player.id,
    siteUserId: input.siteUserId,
    expiresAt,
  });
  return { code, expiresAt, player };
}

export async function redeemSiteLinkCode(code: string, siteUserId: number) {
  const db = await getDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  const now = new Date();
  return db.transaction(async tx => {
    const rows = await tx
      .select()
      .from(linkCodes)
      .where(and(eq(linkCodes.codeHash, hashLinkCode(code)), eq(linkCodes.target, "site"), isNull(linkCodes.consumedAt), isNull(linkCodes.revokedAt), gt(linkCodes.expiresAt, now)))
      .limit(1);
    const linkCode = rows[0];
    if (!linkCode) throw new Error("INVALID_OR_EXPIRED_LINK_CODE");

    const existing = await tx.select().from(accountLinks).where(eq(accountLinks.minecraftPlayerId, linkCode.minecraftPlayerId)).limit(1);
    if (existing[0]?.siteUserId && existing[0].siteUserId !== siteUserId) throw new Error("PLAYER_ALREADY_LINKED");
    if (existing[0]) {
      await tx.update(accountLinks).set({ siteUserId, linkedAt: now, unlinkedAt: null }).where(eq(accountLinks.id, existing[0].id));
    } else {
      await tx.insert(accountLinks).values({ minecraftPlayerId: linkCode.minecraftPlayerId, siteUserId, linkedAt: now });
    }
    await tx.update(linkCodes).set({ consumedAt: now }).where(eq(linkCodes.id, linkCode.id));
    return { minecraftPlayerId: linkCode.minecraftPlayerId, linkedAt: now };
  });
}

export async function unlinkSiteAccount(siteUserId: number) {
  const db = await getDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  await db.update(accountLinks).set({ siteUserId: null, unlinkedAt: new Date() }).where(eq(accountLinks.siteUserId, siteUserId));
}

export async function appendAuditLog(input: typeof auditLogs.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  await db.insert(auditLogs).values(input);
}

export async function getAdminOverview() {
  const db = await getDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  const [players, links, events, audits, status] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(minecraftPlayers),
    db.select({ count: sql<number>`count(*)` }).from(accountLinks).where(isNull(accountLinks.unlinkedAt)),
    db.select({ count: sql<number>`count(*)` }).from(integrationEvents),
    db.select({ count: sql<number>`count(*)` }).from(auditLogs),
    getLatestServerStatus(),
  ]);
  return {
    players: Number(players[0]?.count ?? 0),
    activeLinks: Number(links[0]?.count ?? 0),
    events: Number(events[0]?.count ?? 0),
    auditEntries: Number(audits[0]?.count ?? 0),
    status,
  };
}

export async function getSiteAccountProfile(siteUserId: number) {
  const db = await getDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  const rows = await db
    .select({
      player: minecraftPlayers,
      link: accountLinks,
    })
    .from(accountLinks)
    .innerJoin(minecraftPlayers, eq(accountLinks.minecraftPlayerId, minecraftPlayers.id))
    .where(and(eq(accountLinks.siteUserId, siteUserId), isNull(accountLinks.unlinkedAt)))
    .limit(1);
  return rows[0];
}

export async function getLatestAuditLogs(limit = 20) {
  const db = await getDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  return db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(limit);
}

export async function getDiscordPermissionPolicies(guildId: string) {
  const db = await getDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  return db.select().from(discordRolePermissions).where(eq(discordRolePermissions.guildId, guildId));
}

export async function getIntegrationEventByIdempotencyKey(idempotencyKey: string) {
  const db = await getDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  const rows = await db.select().from(integrationEvents).where(eq(integrationEvents.idempotencyKey, idempotencyKey)).limit(1);
  return rows[0];
}

export async function markIntegrationEventProcessed(id: string) {
  const db = await getDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  await db.update(integrationEvents).set({ status: "processed", processedAt: new Date() }).where(eq(integrationEvents.id, id));
}


export async function revokeLinkCode(code: string) {
  const db = await getDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  const rows = await db.select({ id: linkCodes.id }).from(linkCodes).where(and(eq(linkCodes.codeHash, hashLinkCode(code)), isNull(linkCodes.consumedAt), isNull(linkCodes.revokedAt))).limit(1);
  if (!rows[0]) return false;
  await db.update(linkCodes).set({ revokedAt: new Date() }).where(eq(linkCodes.id, rows[0].id));
  return true;
}

export async function redeemDiscordLinkCode(input: { code: string; discordUserId: string; username: string; globalName?: string | null }) {
  const db = await getDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  const now = new Date();
  return db.transaction(async tx => {
    const rows = await tx
      .select()
      .from(linkCodes)
      .where(and(eq(linkCodes.codeHash, hashLinkCode(input.code)), eq(linkCodes.target, "discord"), isNull(linkCodes.consumedAt), isNull(linkCodes.revokedAt), gt(linkCodes.expiresAt, now)))
      .limit(1);
    const linkCode = rows[0];
    if (!linkCode) throw new Error("INVALID_OR_EXPIRED_LINK_CODE");

    await tx.insert(discordAccounts).values({ discordUserId: input.discordUserId, username: input.username, globalName: input.globalName ?? null }).onDuplicateKeyUpdate({ set: { username: input.username, globalName: input.globalName ?? null } });
    const account = await tx.select().from(discordAccounts).where(eq(discordAccounts.discordUserId, input.discordUserId)).limit(1);
    if (!account[0]) throw new Error("DISCORD_ACCOUNT_NOT_FOUND_AFTER_UPSERT");

    const existing = await tx.select().from(accountLinks).where(eq(accountLinks.minecraftPlayerId, linkCode.minecraftPlayerId)).limit(1);
    if (existing[0]?.discordAccountId && existing[0].discordAccountId !== account[0].id) throw new Error("PLAYER_ALREADY_LINKED");
    if (existing[0]) {
      await tx.update(accountLinks).set({ discordAccountId: account[0].id, linkedAt: now, unlinkedAt: null }).where(eq(accountLinks.id, existing[0].id));
    } else {
      await tx.insert(accountLinks).values({ minecraftPlayerId: linkCode.minecraftPlayerId, discordAccountId: account[0].id, linkedAt: now });
    }
    await tx.update(linkCodes).set({ consumedAt: now }).where(eq(linkCodes.id, linkCode.id));
    return { minecraftPlayerId: linkCode.minecraftPlayerId, discordAccountId: account[0].id, linkedAt: now };
  });
}

export async function unlinkDiscordAccount(discordUserId: string) {
  const db = await getDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  const account = await db.select().from(discordAccounts).where(eq(discordAccounts.discordUserId, discordUserId)).limit(1);
  if (!account[0]) return false;
  await db.update(accountLinks).set({ discordAccountId: null, unlinkedAt: new Date() }).where(eq(accountLinks.discordAccountId, account[0].id));
  return true;
}

export async function listPublicPlayers(limit = 24) {
  const db = await getDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  return db.select({ player: minecraftPlayers, stats: minecraftPlayerStats }).from(minecraftPlayers).leftJoin(minecraftPlayerStats, eq(minecraftPlayers.id, minecraftPlayerStats.minecraftPlayerId)).orderBy(desc(minecraftPlayers.lastSeenAt)).limit(limit);
}

export async function getPlayerStatsAndActivities(minecraftPlayerId: number) {
  const db = await getDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  const [stats, activities] = await Promise.all([
    db.select().from(minecraftPlayerStats).where(eq(minecraftPlayerStats.minecraftPlayerId, minecraftPlayerId)).limit(1),
    db.select().from(playerActivityEvents).where(eq(playerActivityEvents.minecraftPlayerId, minecraftPlayerId)).orderBy(desc(playerActivityEvents.occurredAt)).limit(20),
  ]);
  return { stats: stats[0], activities };
}

export async function getLinkedDiscordAccount(minecraftPlayerId: number) {
  const db = await getDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  const rows = await db.select({ discord: discordAccounts }).from(accountLinks).innerJoin(discordAccounts, eq(accountLinks.discordAccountId, discordAccounts.id)).where(and(eq(accountLinks.minecraftPlayerId, minecraftPlayerId), isNull(accountLinks.unlinkedAt))).limit(1);
  return rows[0]?.discord;
}

export async function ingestPlayerStatsSnapshot(input: { uuid: string; username: string; playtimeSeconds: number; blocksBroken?: number; blocksPlaced?: number; kills?: number; deaths?: number; achievementsCount?: number }) {
  const player = await upsertMinecraftPlayer({ uuid: input.uuid, username: input.username });
  const db = await getDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  await db.insert(minecraftPlayerStats).values({ minecraftPlayerId: player.id, playtimeSeconds: input.playtimeSeconds, blocksBroken: input.blocksBroken ?? 0, blocksPlaced: input.blocksPlaced ?? 0, kills: input.kills ?? 0, deaths: input.deaths ?? 0, achievementsCount: input.achievementsCount ?? 0 }).onDuplicateKeyUpdate({ set: { playtimeSeconds: input.playtimeSeconds, blocksBroken: input.blocksBroken ?? 0, blocksPlaced: input.blocksPlaced ?? 0, kills: input.kills ?? 0, deaths: input.deaths ?? 0, achievementsCount: input.achievementsCount ?? 0 } });
  return player;
}

export async function recordPlayerActivity(input: { uuid: string; username: string; type: string; summary: string }) {
  const player = await upsertMinecraftPlayer({ uuid: input.uuid, username: input.username });
  const db = await getDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  await db.insert(playerActivityEvents).values({ minecraftPlayerId: player.id, type: input.type, summary: input.summary });
  return player;
}

export async function getPendingIntegrationCommands(serverKey: string) {
  const db = await getDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  return db.select().from(integrationEvents).where(and(or(eq(integrationEvents.type, "admin.command.requested"), eq(integrationEvents.type, "chat.discord")), eq(integrationEvents.status, "received"))).limit(50);
}

export async function markIntegrationCommandResult(eventId: string, success: boolean, message?: string) {
  const db = await getDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  await db.update(integrationEvents).set({ status: success ? "processed" : "failed", processedAt: new Date(), failureReason: success ? null : message ?? "COMMAND_FAILED" }).where(eq(integrationEvents.id, eventId));
}

export async function getDiscordLinkedPlayer(discordUserId: string) {
  const db = await getDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  const rows = await db.select({ player: minecraftPlayers, stats: minecraftPlayerStats, discord: discordAccounts }).from(accountLinks).innerJoin(discordAccounts, eq(accountLinks.discordAccountId, discordAccounts.id)).innerJoin(minecraftPlayers, eq(accountLinks.minecraftPlayerId, minecraftPlayers.id)).leftJoin(minecraftPlayerStats, eq(accountLinks.minecraftPlayerId, minecraftPlayerStats.minecraftPlayerId)).where(and(eq(discordAccounts.discordUserId, discordUserId), isNull(accountLinks.unlinkedAt))).limit(1);
  if (!rows[0]) return undefined;
  return { ...rows[0], activities: await getPlayerStatsAndActivities(rows[0].player.id).then(result => result.activities) };
}

export async function getIntegrationCommandStatus(commandId: string) {
  const event = await getIntegrationEventByIdempotencyKey(`discord-command:${commandId}`);
  if (!event) return undefined;
  return { status: event.status, failureReason: event.failureReason, processedAt: event.processedAt };
}

export async function getRecentMinecraftEvents(limit = 50) {
  const db = await getDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  return db.select().from(integrationEvents).where(eq(integrationEvents.origin, "minecraft")).orderBy(desc(integrationEvents.createdAt)).limit(limit);
}

export async function getDiscordDelivery(eventId: string, channelId: string) {
  const db = await getDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  const rows = await db.select().from(discordEventDeliveries).where(and(eq(discordEventDeliveries.eventId, eventId), eq(discordEventDeliveries.channelId, channelId))).limit(1);
  return rows[0];
}

export async function recordDiscordDelivery(input: { eventId: string; eventType: string; channelId: string; success: boolean; error?: string }) {
  const db = await getDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  const key = deliveryKey(input.eventId, input.channelId);
  const current = await getDiscordDelivery(input.eventId, input.channelId);
  if (current?.status === "sent") return { status: "sent", attempts: current.attempts, key };
  const attempts = (current?.attempts ?? 0) + 1;
  const status = input.success ? "sent" : attempts >= 5 ? "failed" : "pending";
  const nextAttemptAt = new Date(Date.now() + retryDelayMs(attempts));
  if (current) {
    await db.update(discordEventDeliveries).set({ status, attempts, lastError: input.success ? null : input.error ?? "DELIVERY_FAILED", nextAttemptAt }).where(eq(discordEventDeliveries.id, current.id));
  } else {
    await db.insert(discordEventDeliveries).values({ eventId: input.eventId, eventType: input.eventType, channelId: input.channelId, status, attempts, lastError: input.success ? null : input.error ?? "DELIVERY_FAILED", nextAttemptAt });
  }
  return { status, attempts, key };
}

export async function getPendingDiscordDeliveries(channelId: string, limit = 500) {
  const db = await getDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  return db.select({ delivery: discordEventDeliveries, event: integrationEvents }).from(integrationEvents).leftJoin(discordEventDeliveries, and(eq(discordEventDeliveries.eventId, integrationEvents.id), eq(discordEventDeliveries.channelId, channelId))).where(and(eq(integrationEvents.origin, "minecraft"), inArray(integrationEvents.type, ["player.joined", "player.left", "chat.minecraft"]), or(isNull(discordEventDeliveries.id), and(eq(discordEventDeliveries.status, "pending"), lte(discordEventDeliveries.nextAttemptAt, new Date()))))).orderBy(desc(integrationEvents.createdAt)).limit(limit);
}
