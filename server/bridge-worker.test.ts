import { describe, expect, it } from "vitest";
import { mergeBridgeEvents, shouldPublishBridgeEvent } from "../discord-bot/src/bridge-worker.mjs";

describe("discord bridge worker", () => {
  it("merges recent and pending events by event ID", () => {
    const result = mergeBridgeEvents([{ id: "a", type: "chat.minecraft" }], [{ id: "a", type: "chat.minecraft", delivery: { status: "sent" } }, { id: "b", type: "player.joined" }]);
    expect(result).toHaveLength(2);
    expect(result.find(event => event.id === "a")?.delivery?.status).toBe("sent");
  });

  it("publishes Minecraft-origin events only to their configured channel", () => {
    const event = { id: "a", type: "chat.minecraft", payload: { bridgeOrigin: "minecraft" } };
    expect(shouldPublishBridgeEvent(event, "channel-chat", { "chat.minecraft": "channel-chat", fallback: "channel-default" })).toBe(true);
    expect(shouldPublishBridgeEvent(event, "channel-default", { "chat.minecraft": "channel-chat", fallback: "channel-default" })).toBe(false);
  });

  it("blocks Discord-origin events and duplicate delivery keys", () => {
    const discordEvent = { id: "a", type: "chat.minecraft", payload: { bridgeOrigin: "discord" } };
    const minecraftEvent = { id: "b", type: "chat.minecraft", payload: { bridgeOrigin: "minecraft" } };
    const seen = new Set(["b:channel-chat"]);
    expect(shouldPublishBridgeEvent(discordEvent, "channel-chat", { "chat.minecraft": "channel-chat" }, seen)).toBe(false);
    expect(shouldPublishBridgeEvent(minecraftEvent, "channel-chat", { "chat.minecraft": "channel-chat" }, seen)).toBe(false);
  });
});
