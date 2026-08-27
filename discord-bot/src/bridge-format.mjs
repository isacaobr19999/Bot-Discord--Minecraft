import { parseEventPayload } from "./event-payload.mjs";

export function formatMinecraftBridgeEvent(event) {
  const payload = parseEventPayload(event?.payload);
  const username = typeof payload.username === "string" && payload.username.trim() ? payload.username.trim() : "jogador";
  const message = typeof payload.message === "string" && payload.message.trim() ? payload.message.trim() : "(mensagem sem conteúdo)";

  if (event?.type === "chat.minecraft") return `<${username}> ${message}`;
  if (event?.type === "player.joined") return `**${username}** entrou no servidor.`;
  return `**${username}** saiu do servidor.`;
}
