CREATE TABLE `md_chunks` (
	`id` text NOT NULL,
	`sha` text NOT NULL,
	`start_ts` integer NOT NULL,
	`body` text NOT NULL,
	PRIMARY KEY(`id`, `sha`)
);
--> statement-breakpoint
CREATE INDEX `idx_md_chunks_start_ts` ON `md_chunks` (`start_ts`);--> statement-breakpoint
CREATE TABLE `md_gate` (
	`key` text PRIMARY KEY NOT NULL,
	`owner` text DEFAULT '' NOT NULL,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`next_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `md_snapshots` (
	`key` text PRIMARY KEY NOT NULL,
	`body` text NOT NULL,
	`updated_at` integer NOT NULL
);
