import { describe, expect, it } from "vitest";
import { deliveryKey, isDuplicate, retryDelayMs, shouldForward } from "./bridge-policy";

describe("bridge policy", () => {
  it("deduplicates by event and channel", () => {
    const seen = new Set([deliveryKey("event-1", "channel-a")]);
    expect(isDuplicate(seen, "event-1", "channel-a")).toBe(true);
    expect(isDuplicate(seen, "event-1", "channel-b")).toBe(false);
  });

  it("uses bounded exponential retry delay", () => {
    expect(retryDelayMs(1)).toBe(1000);
    expect(retryDelayMs(3)).toBe(9000);
    expect(retryDelayMs(99)).toBe(300000);
  });

  it("forwards only between different origins", () => {
    expect(shouldForward("minecraft", "discord")).toBe(true);
    expect(shouldForward("discord", "minecraft")).toBe(true);
    expect(shouldForward("minecraft", "minecraft")).toBe(false);
  });
});
