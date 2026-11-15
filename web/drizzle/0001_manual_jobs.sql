CREATE TABLE `md_jobs` (
 `id` text PRIMARY KEY NOT NULL,
 `client` text NOT NULL,
 `from_ts` integer NOT NULL,
 `to_ts` integer NOT NULL,
 `created_at` integer NOT NULL,
 `completed_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_md_jobs_client` ON `md_jobs` (`client`, `created_at`);
