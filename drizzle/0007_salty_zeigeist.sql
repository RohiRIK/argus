CREATE TABLE `audit` (
	`id` text PRIMARY KEY NOT NULL,
	`action` text NOT NULL,
	`provider` text,
	`outcome` text NOT NULL,
	`detail` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_audit_created` ON `audit` (`created_at`);