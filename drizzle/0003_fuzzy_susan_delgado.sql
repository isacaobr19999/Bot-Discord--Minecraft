CREATE TABLE `discordEventDeliveries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`eventId` varchar(64) NOT NULL,
	`eventType` varchar(96) NOT NULL,
	`channelId` varchar(32) NOT NULL,
	`status` enum('pending','sent','failed') NOT NULL DEFAULT 'pending',
	`attempts` int NOT NULL DEFAULT 0,
	`lastError` text,
	`nextAttemptAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `discordEventDeliveries_id` PRIMARY KEY(`id`),
	CONSTRAINT `discordEventDeliveries_event_channel_unique` UNIQUE(`eventId`,`channelId`)
);
--> statement-breakpoint
CREATE INDEX `discordEventDeliveries_pending_idx` ON `discordEventDeliveries` (`status`,`nextAttemptAt`);