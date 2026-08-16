import express from "express";
import http from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ keys: new Set<string>(), audit: [] as string[], results: [] as string[] }));

vi.mock("./db", () => {
  const noop = vi.fn(async () => undefined);
  return {
    appendAuditLog: vi.fn(async (input: { action: string }) => { state.audit.push(input.action); }),
    createMinecraftLinkCode: noop,
    getDb: vi.fn(async () => ({
      insert: () => ({
        values: async (event: { idempotencyKey: string }) => {
          if (state.keys.has(event.idempotencyKey)) throw new Error("Duplicate entry");
          state.keys.add(event.idempotencyKey);
        },
      }),
    })),
    getDiscordDelivery: noop,
    getDiscordLinkedPlayer: noop,
    getDiscordPermissionPolicies: noop,
    getIntegrationCommandStatus: noop,
    getLatestServerStatus: noop,
    getPendingDiscordDeliveries: noop,
    getPendingIntegrationCommands: noop,
    getPublicPlayerProfile: noop,
    getRecentMinecraftEvents: noop,
    ingestPlayerStatsSnapshot: noop,
    markIntegrationCommandResult: vi.fn(async (eventId: string) => { state.results.push(eventId); }),
    recordDiscordDelivery: noop,
    recordPlayerActivity: noop,
    redeemDiscordLinkCode: vi.fn(async () => ({ minecraftPlayerId: 7, discordAccountId: 8 })),
    revokeLinkCode: noop,
    unlinkDiscordAccount: noop,
  };
});

const { registerIntegrationApi } = await import("./integration-api");
const servers: http.Server[] = [];

afterEach(() => {
  state.keys.clear();
  state.audit.length = 0;
  state.results.length = 0;
  for (const server of servers.splice(0)) server.close();
});

describe("integration idempotency", () => {
  async function post(path: string, body: unknown) {
    process.env.INTEGRATION_API_KEY = "test-key";
    const app = express();
    app.use(express.json());
    registerIntegrationApi(app);
    const server = http.createServer(app);
    servers.push(server);
    await new Promise<void>(resolve => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("server did not bind");
    return fetch(`http://127.0.0.1:${address.port}${path}`, { method: "POST", headers: { "content-type": "application/json", "x-integration-key": "test-key" }, body: JSON.stringify(body) });
  }

  it("deduplicates chat by Discord message ID", async () => {
    const body = { messageId: "message-1", authorId: "user-1", guildId: "guild-1", message: "hello", bridgeOrigin: "discord" };
    const first = await post("/api/integration/chat/discord", body);
    const second = await post("/api/integration/chat/discord", body);
    expect(first.status).toBe(202);
    expect(second.status).toBe(200);
    await expect(second.json()).resolves.toMatchObject({ deduplicated: true });
  });

  it("audits a successful Discord account redemption", async () => {
    const response = await post("/api/integration/link-codes/redeem-discord", { code: "123456", discordUserId: "discord-user-1", username: "Player" });
    expect(response.status).toBe(200);
    expect(state.audit).toContain("account.link.redeem.discord");
  });

  it("records the final administrative command result in audit", async () => {
    const response = await post("/api/integration/admin/commands/result", { eventId: "00000000-0000-4000-8000-000000000001", success: true, message: "executed" });
    expect(response.status).toBe(200);
    expect(state.results).toEqual(["00000000-0000-4000-8000-000000000001"]);
    expect(state.audit).toContain("admin.command.result");
  });

  it("deduplicates administrative commands by command ID", async () => {
    const body = { commandId: "command-1", action: "say", actorId: "user-1", guildId: "guild-1", roleIds: ["role-1"], parameters: { mensagem: "hello" } };
    const first = await post("/api/integration/admin/commands", body);
    const second = await post("/api/integration/admin/commands", body);
    expect(first.status).toBe(202);
    expect(second.status).toBe(200);
    await expect(second.json()).resolves.toMatchObject({ deduplicated: true });
  });
});
