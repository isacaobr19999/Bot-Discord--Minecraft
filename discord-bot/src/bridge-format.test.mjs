import { describe, expect, it } from "vitest";
import { formatMinecraftBridgeEvent } from "./bridge-format.mjs";

describe("formatação da bridge Minecraft", () => {
  it("usa o nome do jogador em eventos de entrada", () => {
    expect(formatMinecraftBridgeEvent({ type: "player.joined", payload: { username: "_Nube" } }))
      .toBe("**_Nube** entrou no servidor.");
  });

  it("não publica undefined quando o payload antigo não tem nome", () => {
    expect(formatMinecraftBridgeEvent({ type: "player.joined", payload: {} }))
      .toBe("**jogador** entrou no servidor.");
  });

  it("usa fallback seguro para mensagem de chat ausente", () => {
    expect(formatMinecraftBridgeEvent({ type: "chat.minecraft", payload: { username: "_Nube" } }))
      .toBe("<_Nube> (mensagem sem conteúdo)");
  });
});
