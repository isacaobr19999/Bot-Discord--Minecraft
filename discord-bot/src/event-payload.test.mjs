import { describe, expect, it } from "vitest";
import { parseEventPayload } from "./event-payload.mjs";

describe("normalização de payload de evento", () => {
  it("preserva payload objeto", () => {
    const payload = { username: "_Nube", rank: "obsidian" };
    expect(parseEventPayload(payload)).toBe(payload);
  });

  it("converte JSON serializado retornado pelo MariaDB", () => {
    expect(parseEventPayload('{"username":"_Nube","rank":"obsidian"}'))
      .toEqual({ username: "_Nube", rank: "obsidian" });
  });

  it("retorna objeto vazio para JSON inválido ou arrays", () => {
    expect(parseEventPayload("não é JSON")).toEqual({});
    expect(parseEventPayload("[]")).toEqual({});
  });
});
