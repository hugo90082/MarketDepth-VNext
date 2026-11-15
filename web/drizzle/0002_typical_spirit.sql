CREATE TABLE `md_shared_versions` (
	`key` text NOT NULL,
	`kind` text NOT NULL,
	`asset` text NOT NULL,
	`at` integer NOT NULL,
	`body` text NOT NULL,
	`hash` text NOT NULL,
	`version` integer NOT NULL,
	`final_version` integer DEFAULT -1 NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`key`, `version`)
);
--> statement-breakpoint
CREATE INDEX `idx_shared_versions_kind_time` ON `md_shared_versions` (`kind`,`at`);
--> statement-breakpoint
INSERT OR IGNORE INTO md_shared_versions SELECT * FROM md_shared_records;
