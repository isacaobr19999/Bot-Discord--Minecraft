export type BridgeOrigin = "minecraft" | "discord";

export function deliveryKey(eventId: string, channelId: string) {
  return `${eventId}:${channelId}`;
}

export function retryDelayMs(attempts: number) {
  return Math.min(Math.max(1, attempts) ** 2 * 1000, 300_000);
}

export function shouldForward(origin: BridgeOrigin, target: BridgeOrigin) {
  return origin !== target;
}

export function isDuplicate(seen: ReadonlySet<string>, eventId: string, channelId: string) {
  return seen.has(deliveryKey(eventId, channelId));
}
