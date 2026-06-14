ALTER TABLE `settings` ADD `timezone` text DEFAULT 'UTC' NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `retention_days` integer DEFAULT 90 NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `from_address` text;--> statement-breakpoint
ALTER TABLE `settings` ADD `reply_to` text;