ALTER TABLE `executions` ADD `trigger` text;--> statement-breakpoint
ALTER TABLE `executions` ADD `delivery_status` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `delivery_mode` text DEFAULT 'email' NOT NULL;