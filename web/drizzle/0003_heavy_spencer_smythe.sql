DROP TABLE `md_qualification`;--> statement-breakpoint
DROP TABLE `md_shared_conflicts`;--> statement-breakpoint
DROP TABLE `md_shared_records`;--> statement-breakpoint
DROP TABLE `md_shared_versions`;--> statement-breakpoint
DELETE FROM md_snapshots WHERE key LIKE 'shared-%';--> statement-breakpoint
DELETE FROM md_gate WHERE key LIKE 'shared-%';
