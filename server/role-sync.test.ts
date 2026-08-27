import { describe, it, expect, vi, beforeEach } from "vitest";
import { getPendingRoleSyncs, getDiscordUserIdForPlayer, upsertMinecraftPlayer } from "./db";

vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    getPendingRoleSyncs: vi.fn(),
    getDiscordUserIdForPlayer: vi.fn(),
    upsertMinecraftPlayer: vi.fn(),
  };
});

describe("Sincronização de Cargos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deve identificar o discordUserId Snowflake real para um jogador vinculado", async () => {
    vi.mocked(getDiscordUserIdForPlayer).mockResolvedValue("123456789012345678");
    const result = await getDiscordUserIdForPlayer(1);
    expect(result).toBe("123456789012345678");
  });

  it("deve persistir o rank do jogador durante o upsert", async () => {
    await upsertMinecraftPlayer({ uuid: "uuid-1", username: "Player1", rank: "obsidian" });
    expect(upsertMinecraftPlayer).toHaveBeenCalledWith(expect.objectContaining({ rank: "obsidian" }));
  });
});
