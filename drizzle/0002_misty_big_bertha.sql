CREATE TABLE `minecraftPlayerStats` (
	`id` int AUTO_INCREMENT NOT NULL,
	`minecraftPlayerId` int NOT NULL,
	`playtimeSeconds` int NOT NULL DEFAULT 0,
	`blocksBroken` int NOT NULL DEFAULT 0,
	`blocksPlaced` int NOT NULL DEFAULT 0,
	`kills` int NOT NULL DEFAULT 0,
	`deaths` int NOT NULL DEFAULT 0,
	`achievementsCount` int NOT NULL DEFAULT 0,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `minecraftPlayerStats_id` PRIMARY KEY(`id`),
	CONSTRAINT `minecraftPlayerStats_minecraftPlayerId_unique` UNIQUE(`minecraftPlayerId`)
);
--> statement-breakpoint
CREATE TABLE `playerActivityEvents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`minecraftPlayerId` int NOT NULL,
	`type` varchar(64) NOT NULL,
	`summary` varchar(255) NOT NULL,
	`occurredAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `playerActivityEvents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `playerActivityEvents_player_occurred_idx` ON `playerActivityEvents` (`minecraftPlayerId`,`occurredAt`);