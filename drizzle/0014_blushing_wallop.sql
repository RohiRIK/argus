CREATE TABLE `recipient_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`entra_group_id` text,
	`entra_display_name` text,
	`managed_by_argus` integer DEFAULT false NOT NULL,
	`static_members` text DEFAULT '[]' NOT NULL,
	`cached_entra_members` text DEFAULT '[]' NOT NULL,
	`last_synced_at` text,
	`last_sync_error` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recipient_groups_name_unique` ON `recipient_groups` (`name`);--> statement-breakpoint
ALTER TABLE `jobs` ADD `recipient_group_ids` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `global_recipient_group_ids` text DEFAULT '[]' NOT NULL;