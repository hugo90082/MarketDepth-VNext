CREATE TABLE `md_market_blocks` (
	`base` integer PRIMARY KEY NOT NULL,
	`version` integer NOT NULL,
	`sha` text NOT NULL,
	`body` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_md_market_version` ON `md_market_blocks` (`version`);--> statement-breakpoint
CREATE TABLE `md_market_collectors` (
	`id` text PRIMARY KEY NOT NULL,
	`client` text NOT NULL,
	`session` text NOT NULL,
	`expires_at` integer NOT NULL,
	`qualified_at` integer,
	`proof` text,
	`last_batch_id` text,
	`last_batch_hash` text,
	`last_receipt` text
);
