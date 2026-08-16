CREATE TABLE `accountLinks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`minecraftPlayerId` int NOT NULL,
	`discordAccountId` int,
	`siteUserId` int,
	`linkedAt` timestamp NOT NULL DEFAULT (now()),
	`unlinkedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `accountLinks_id` PRIMARY KEY(`id`),
	CONSTRAINT `accountLinks_minecraftPlayerId_unique` UNIQUE(`minecraftPlayerId`),
	CONSTRAINT `accountLinks_discordAccountId_unique` UNIQUE(`discordAccountId`),
	CONSTRAINT `accountLinks_siteUserId_unique` UNIQUE(`siteUserId`)
);
--> statement-breakpoint
CREATE TABLE `auditLogs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`actorType` enum('site_user','discord_user','minecraft_player','system') NOT NULL,
	`actorId` varchar(128) NOT NULL,
	`action` varchar(128) NOT NULL,
	`resourceType` varchar(96) NOT NULL,
	`resourceId` varchar(128),
	`outcome` enum('allowed','denied','succeeded','failed') NOT NULL,
	`correlationId` varchar(64),
	`metadata` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `auditLogs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `discordAccounts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`discordUserId` varchar(32) NOT NULL,
	`username` varchar(128) NOT NULL,
	`globalName` varchar(128),
	`avatarUrl` varchar(512),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `discordAccounts_id` PRIMARY KEY(`id`),
	CONSTRAINT `discordAccounts_discordUserId_unique` UNIQUE(`discordUserId`)
);
--> statement-breakpoint
CREATE TABLE `discordRolePermissions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`guildId` varchar(32) NOT NULL,
	`roleId` varchar(32) NOT NULL,
	`permission` varchar(96) NOT NULL,
	`enabled` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `discordRolePermissions_id` PRIMARY KEY(`id`),
	CONSTRAINT `discordRolePermissions_policy_unique` UNIQUE(`guildId`,`roleId`,`permission`)
);
--> statement-breakpoint
CREATE TABLE `integrationEvents` (
	`id` varchar(64) NOT NULL,
	`idempotencyKey` varchar(128) NOT NULL,
	`type` varchar(96) NOT NULL,
	`origin` enum('minecraft','discord','backend','web') NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`correlationId` varchar(64),
	`status` enum('received','processed','failed','discarded') NOT NULL DEFAULT 'received',
	`payload` json NOT NULL,
	`failureReason` text,
	`processedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `integrationEvents_id` PRIMARY KEY(`id`),
	CONSTRAINT `integrationEvents_idempotencyKey_unique` UNIQUE(`idempotencyKey`)
);
--> statement-breakpoint
CREATE TABLE `linkCodes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`codeHash` varchar(128) NOT NULL,
	`target` enum('discord','site') NOT NULL,
	`minecraftPlayerId` int NOT NULL,
	`siteUserId` int,
	`expiresAt` timestamp NOT NULL,
	`consumedAt` timestamp,
	`revokedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `linkCodes_id` PRIMARY KEY(`id`),
	CONSTRAINT `linkCodes_codeHash_unique` UNIQUE(`codeHash`)
);
--> statement-breakpoint
CREATE TABLE `minecraftPlayers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`uuid` varchar(36) NOT NULL,
	`username` varchar(16) NOT NULL,
	`lastKnownRank` varchar(64),
	`firstSeenAt` timestamp NOT NULL DEFAULT (now()),
	`lastSeenAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `minecraftPlayers_id` PRIMARY KEY(`id`),
	CONSTRAINT `minecraftPlayers_uuid_unique` UNIQUE(`uuid`)
);
--> statement-breakpoint
CREATE TABLE `serverInstances` (
	`id` int AUTO_INCREMENT NOT NULL,
	`serverKey` varchar(64) NOT NULL,
	`displayName` varchar(128) NOT NULL,
	`enabled` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `serverInstances_id` PRIMARY KEY(`id`),
	CONSTRAINT `serverInstances_serverKey_unique` UNIQUE(`serverKey`)
);
--> statement-breakpoint
CREATE TABLE `serverStatusSnapshots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`serverInstanceId` int NOT NULL,
	`online` boolean NOT NULL,
	`playersOnline` int NOT NULL DEFAULT 0,
	`playerLimit` int NOT NULL DEFAULT 0,
	`tps` varchar(12),
	`minecraftVersion` varchar(64),
	`uptimeSeconds` int NOT NULL DEFAULT 0,
	`receivedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `serverStatusSnapshots_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `auditLogs_action_created_idx` ON `auditLogs` (`action`,`createdAt`);--> statement-breakpoint
CREATE INDEX `auditLogs_actor_created_idx` ON `auditLogs` (`actorType`,`actorId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `integrationEvents_type_status_idx` ON `integrationEvents` (`type`,`status`);--> statement-breakpoint
CREATE INDEX `integrationEvents_createdAt_idx` ON `integrationEvents` (`createdAt`);--> statement-breakpoint
CREATE INDEX `linkCodes_player_state_idx` ON `linkCodes` (`minecraftPlayerId`,`expiresAt`);--> statement-breakpoint
CREATE INDEX `minecraftPlayers_username_idx` ON `minecraftPlayers` (`username`);--> statement-breakpoint
CREATE INDEX `serverStatusSnapshots_server_received_idx` ON `serverStatusSnapshots` (`serverInstanceId`,`receivedAt`);