import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, publicProcedure, adminProcedure, router } from "./_core/trpc";
import {
  appendAuditLog,
  getAdminOverview,
  getDiscordPermissionPolicies,
  getLinkedDiscordAccount,
  getPlayerStatsAndActivities,
  listPublicPlayers,
  getLatestAuditLogs,
  getLatestServerStatus,
  getPublicPlayerProfile,
  getSiteAccountProfile,
  redeemSiteLinkCode,
  unlinkSiteAccount,
} from "./db";

function mapDomainError(error: unknown): never {
  const message = error instanceof Error ? error.message : "INTERNAL_ERROR";
  const code = message === "INVALID_OR_EXPIRED_LINK_CODE" ? "BAD_REQUEST" : message === "PLAYER_ALREADY_LINKED" ? "CONFLICT" : "INTERNAL_SERVER_ERROR";
  throw new TRPCError({ code, message });
}

export const platformRouter = router({
  server: router({
    status: publicProcedure
      .input(z.object({ serverKey: z.string().min(1).max(64).default("primary") }))
      .query(({ input }) => getLatestServerStatus(input.serverKey)),
  }),

  players: router({
    list: publicProcedure
      .input(z.object({ limit: z.number().int().min(1).max(48).default(24) }))
      .query(({ input }) => listPublicPlayers(input.limit)),
    profile: publicProcedure
      .input(z.object({ username: z.string().min(1).max(16) }))
      .query(async ({ input }) => {
        const result = await getPublicPlayerProfile(input.username);
        if (!result) return undefined;
        return { ...result, ...await getPlayerStatsAndActivities(result.player.id), discord: await getLinkedDiscordAccount(result.player.id) };
      }),
  }),

  account: router({
    current: protectedProcedure.query(async ({ ctx }) => {
      const result = await getSiteAccountProfile(ctx.user.id);
      if (!result) return undefined;
      return { ...result, ...await getPlayerStatsAndActivities(result.player.id), discord: await getLinkedDiscordAccount(result.player.id) };
    }),
    redeemLinkCode: protectedProcedure
      .input(z.object({ code: z.string().regex(/^\d{6}$/) }))
      .mutation(async ({ ctx, input }) => {
        try {
          const result = await redeemSiteLinkCode(input.code, ctx.user.id);
          await appendAuditLog({
            actorType: "site_user",
            actorId: String(ctx.user.id),
            action: "account.link.redeem",
            resourceType: "minecraft_player",
            resourceId: String(result.minecraftPlayerId),
            outcome: "succeeded",
          });
          return result;
        } catch (error) {
          try {
            await appendAuditLog({
              actorType: "site_user",
              actorId: String(ctx.user.id),
              action: "account.link.redeem",
              resourceType: "link_code",
              outcome: "failed",
            });
          } catch {
            // A falha de auditoria não deve esconder a falha de domínio original.
          }
          return mapDomainError(error);
        }
      }),
    unlink: protectedProcedure.mutation(async ({ ctx }) => {
      await unlinkSiteAccount(ctx.user.id);
      await appendAuditLog({
        actorType: "site_user",
        actorId: String(ctx.user.id),
        action: "account.unlink.site",
        resourceType: "account_link",
        outcome: "succeeded",
      });
      return { success: true } as const;
    }),
  }),

  admin: router({
    overview: adminProcedure.query(() => getAdminOverview()),
    auditLogs: adminProcedure
      .input(z.object({ limit: z.number().int().min(1).max(100).default(25) }))
      .query(({ input }) => getLatestAuditLogs(input.limit)),
    discordPermissions: adminProcedure
      .input(z.object({ guildId: z.string().min(2).max(32) }))
      .query(({ input }) => getDiscordPermissionPolicies(input.guildId)),
  }),
});
