import {
  boolean,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

/** Conta autenticada do site. */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

/** Jogador identificado pelo UUID imutável; o nome é somente de exibição. */
export const minecraftPlayers = mysqlTable(
  "minecraftPlayers",
  {
    id: int("id").autoincrement().primaryKey(),
    uuid: varchar("uuid", { length: 36 }).notNull(),
    username: varchar("username", { length: 16 }).notNull(),
    lastKnownRank: varchar("lastKnownRank", { length: 64 }),
    firstSeenAt: timestamp("firstSeenAt").defaultNow().notNull(),
    lastSeenAt: timestamp("lastSeenAt").defaultNow().notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    uniqueIndex("minecraftPlayers_uuid_unique").on(table.uuid),
    index("minecraftPlayers_username_idx").on(table.username),
  ]
);

/** Identidade Discord mantida por ID imutável, nunca por nome ou tag. */
export const discordAccounts = mysqlTable(
  "discordAccounts",
  {
    id: int("id").autoincrement().primaryKey(),
    discordUserId: varchar("discordUserId", { length: 32 }).notNull(),
    username: varchar("username", { length: 128 }).notNull(),
    globalName: varchar("globalName", { length: 128 }),
    avatarUrl: varchar("avatarUrl", { length: 512 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [uniqueIndex("discordAccounts_discordUserId_unique").on(table.discordUserId)]
);

/** Vínculo único entre um jogador e as identidades autenticadas vinculadas. */
export const accountLinks = mysqlTable(
  "accountLinks",
  {
    id: int("id").autoincrement().primaryKey(),
    minecraftPlayerId: int("minecraftPlayerId").notNull(),
    discordAccountId: int("discordAccountId"),
    siteUserId: int("siteUserId"),
    linkedAt: timestamp("linkedAt").defaultNow().notNull(),
    unlinkedAt: timestamp("unlinkedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    uniqueIndex("accountLinks_minecraftPlayerId_unique").on(table.minecraftPlayerId),
    uniqueIndex("accountLinks_discordAccountId_unique").on(table.discordAccountId),
    uniqueIndex("accountLinks_siteUserId_unique").on(table.siteUserId),
  ]
);

/** Códigos temporários: somente o hash é persistido. */
export const linkCodes = mysqlTable(
  "linkCodes",
  {
    id: int("id").autoincrement().primaryKey(),
    codeHash: varchar("codeHash", { length: 128 }).notNull(),
    target: mysqlEnum("target", ["discord", "site"]).notNull(),
    minecraftPlayerId: int("minecraftPlayerId").notNull(),
    siteUserId: int("siteUserId"),
    expiresAt: timestamp("expiresAt").notNull(),
    consumedAt: timestamp("consumedAt"),
    revokedAt: timestamp("revokedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [
    uniqueIndex("linkCodes_codeHash_unique").on(table.codeHash),
    index("linkCodes_player_state_idx").on(table.minecraftPlayerId, table.expiresAt),
  ]
);

/** Configuração de uma instância Minecraft conectada à plataforma. */
export const serverInstances = mysqlTable(
  "serverInstances",
  {
    id: int("id").autoincrement().primaryKey(),
    serverKey: varchar("serverKey", { length: 64 }).notNull(),
    displayName: varchar("displayName", { length: 128 }).notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [uniqueIndex("serverInstances_serverKey_unique").on(table.serverKey)]
);

/** Snapshot recebido do plugin, usado para status público e telemetria. */
export const serverStatusSnapshots = mysqlTable(
  "serverStatusSnapshots",
  {
    id: int("id").autoincrement().primaryKey(),
    serverInstanceId: int("serverInstanceId").notNull(),
    online: boolean("online").notNull(),
    playersOnline: int("playersOnline").default(0).notNull(),
    playerLimit: int("playerLimit").default(0).notNull(),
    tps: varchar("tps", { length: 12 }),
    minecraftVersion: varchar("minecraftVersion", { length: 64 }),
    uptimeSeconds: int("uptimeSeconds").default(0).notNull(),
    receivedAt: timestamp("receivedAt").defaultNow().notNull(),
  },
  table => [index("serverStatusSnapshots_server_received_idx").on(table.serverInstanceId, table.receivedAt)]
);

/** Evento durável e idempotente entre os componentes da plataforma. */
export const integrationEvents = mysqlTable(
  "integrationEvents",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    idempotencyKey: varchar("idempotencyKey", { length: 128 }).notNull(),
    type: varchar("type", { length: 96 }).notNull(),
    origin: mysqlEnum("origin", ["minecraft", "discord", "backend", "web"]).notNull(),
    version: int("version").default(1).notNull(),
    correlationId: varchar("correlationId", { length: 64 }),
    status: mysqlEnum("status", ["received", "processed", "failed", "discarded"]).default("received").notNull(),
    payload: json("payload").notNull(),
    failureReason: text("failureReason"),
    processedAt: timestamp("processedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [
    uniqueIndex("integrationEvents_idempotencyKey_unique").on(table.idempotencyKey),
    index("integrationEvents_type_status_idx").on(table.type, table.status),
    index("integrationEvents_createdAt_idx").on(table.createdAt),
  ]
);

/** Política configurável de permissão Discord, sem cargos hardcoded. */
export const discordRolePermissions = mysqlTable(
  "discordRolePermissions",
  {
    id: int("id").autoincrement().primaryKey(),
    guildId: varchar("guildId", { length: 32 }).notNull(),
    roleId: varchar("roleId", { length: 32 }).notNull(),
    permission: varchar("permission", { length: 96 }).notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [uniqueIndex("discordRolePermissions_policy_unique").on(table.guildId, table.roleId, table.permission)]
);

/** Registro imutável de ações administrativas e decisões de autorização. */
export const auditLogs = mysqlTable(
  "auditLogs",
  {
    id: int("id").autoincrement().primaryKey(),
    actorType: mysqlEnum("actorType", ["site_user", "discord_user", "minecraft_player", "system"]).notNull(),
    actorId: varchar("actorId", { length: 128 }).notNull(),
    action: varchar("action", { length: 128 }).notNull(),
    resourceType: varchar("resourceType", { length: 96 }).notNull(),
    resourceId: varchar("resourceId", { length: 128 }),
    outcome: mysqlEnum("outcome", ["allowed", "denied", "succeeded", "failed"]).notNull(),
    correlationId: varchar("correlationId", { length: 64 }),
    metadata: json("metadata"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [
    index("auditLogs_action_created_idx").on(table.action, table.createdAt),
    index("auditLogs_actor_created_idx").on(table.actorType, table.actorId, table.createdAt),
  ]
);

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type MinecraftPlayer = typeof minecraftPlayers.$inferSelect;
export type DiscordAccount = typeof discordAccounts.$inferSelect;
export type ServerStatusSnapshot = typeof serverStatusSnapshots.$inferSelect;

/** Estatísticas agregadas do jogador, atualizadas por eventos do plugin. */
export const minecraftPlayerStats = mysqlTable("minecraftPlayerStats", {
  id: int("id").autoincrement().primaryKey(),
  minecraftPlayerId: int("minecraftPlayerId").notNull().unique(),
  playtimeSeconds: int("playtimeSeconds").default(0).notNull(),
  blocksBroken: int("blocksBroken").default(0).notNull(),
  blocksPlaced: int("blocksPlaced").default(0).notNull(),
  kills: int("kills").default(0).notNull(),
  deaths: int("deaths").default(0).notNull(),
  achievementsCount: int("achievementsCount").default(0).notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/** Linha de atividade pública/autorizada exibida no perfil do jogador. */
export const playerActivityEvents = mysqlTable("playerActivityEvents", {
  id: int("id").autoincrement().primaryKey(),
  minecraftPlayerId: int("minecraftPlayerId").notNull(),
  type: varchar("type", { length: 64 }).notNull(),
  summary: varchar("summary", { length: 255 }).notNull(),
  occurredAt: timestamp("occurredAt").defaultNow().notNull(),
}, table => [index("playerActivityEvents_player_occurred_idx").on(table.minecraftPlayerId, table.occurredAt)]);

/** Entrega durável de eventos Minecraft para canais Discord. */
export const discordEventDeliveries = mysqlTable("discordEventDeliveries", {
  id: int("id").autoincrement().primaryKey(),
  eventId: varchar("eventId", { length: 64 }).notNull(),
  eventType: varchar("eventType", { length: 96 }).notNull(),
  channelId: varchar("channelId", { length: 32 }).notNull(),
  status: mysqlEnum("status", ["pending", "sent", "failed"]).default("pending").notNull(),
  attempts: int("attempts").default(0).notNull(),
  lastError: text("lastError"),
  nextAttemptAt: timestamp("nextAttemptAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [uniqueIndex("discordEventDeliveries_event_channel_unique").on(table.eventId, table.channelId), index("discordEventDeliveries_pending_idx").on(table.status, table.nextAttemptAt)]);
