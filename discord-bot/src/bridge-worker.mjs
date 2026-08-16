const BRIDGE_EVENT_TYPES = new Set(["player.joined", "player.left", "chat.minecraft"]);

export function bridgeDeliveryKey(eventId, channelId) {
  return `${eventId}:${channelId}`;
}

export function mergeBridgeEvents(recentEvents = [], pendingEvents = []) {
  return [...new Map([...recentEvents, ...pendingEvents].map(event => [event.id, event])).values()];
}

export function shouldPublishBridgeEvent(event, channelId, configuredChannels, seenKeys = new Set()) {
  if (!BRIDGE_EVENT_TYPES.has(event.type)) return false;
  if ((event.payload ?? {}).bridgeOrigin === "discord") return false;
  const targetChannel = configuredChannels[event.type] ?? configuredChannels.fallback;
  if (targetChannel !== channelId) return false;
  const key = bridgeDeliveryKey(event.id, channelId);
  if (event.delivery?.status === "sent" || seenKeys.has(key)) return false;
  return true;
}
