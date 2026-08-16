import express from "express";
import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { registerIntegrationApi } from "./integration-api";

const servers: http.Server[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

describe("bridge integration routes", () => {
  async function request(path: string, init?: RequestInit) {
    const app = express();
    app.use(express.json());
    registerIntegrationApi(app);
    const server = http.createServer(app);
    servers.push(server);
    await new Promise<void>(resolve => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("server did not bind");
    return fetch(`http://127.0.0.1:${address.port}${path}`, init);
  }

  it("protects the dedicated Discord chat route", async () => {
    const response = await request("/api/integration/chat/discord", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messageId: "message-1", authorId: "user-1", guildId: "guild-1", message: "hello", bridgeOrigin: "discord" }) });
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ accepted: false, error: "UNAUTHORIZED" });
  });

  it("protects the durable pending-delivery route", async () => {
    const response = await request("/api/integration/discord-feed/pending?channelId=channel-1");
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ events: [], error: "UNAUTHORIZED" });
  });
});
