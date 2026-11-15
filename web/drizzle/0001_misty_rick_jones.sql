CREATE TABLE `md_qualification` (
	`id` text PRIMARY KEY NOT NULL,
	`session` text NOT NULL,
	`collector` text NOT NULL,
	`expires_at` integer NOT NULL,
	`challenge` text NOT NULL,
	`body` text NOT NULL,
	`hash` text NOT NULL,
	`used` integer DEFAULT 0 NOT NULL,
	`downloaded` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `md_shared_conflicts` (
	`key` text NOT NULL,
	`hash` text NOT NULL,
	`body` text NOT NULL,
	`at` integer NOT NULL,
	PRIMARY KEY(`key`, `hash`)
);
--> statement-breakpoint
CREATE TABLE `md_shared_records` (
	`key` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`asset` text NOT NULL,
	`at` integer NOT NULL,
	`body` text NOT NULL,
	`hash` text NOT NULL,
	`version` integer NOT NULL,
	`final_version` integer DEFAULT -1 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_shared_kind_time` ON `md_shared_records` (`kind`,`at`);--> statement-breakpoint
CREATE INDEX `idx_shared_version` ON `md_shared_records` (`version`);