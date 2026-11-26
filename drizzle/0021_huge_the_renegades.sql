ALTER TABLE `settings` ADD `entra_sign_in` text DEFAULT '{"enabled":false,"groups":{}}' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `role` text DEFAULT 'admin' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `disabled_at` text;--> statement-breakpoint
ALTER TABLE `users` ADD `auth_source` text DEFAULT 'local' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `entra_oid` text;--> statement-breakpoint
ALTER TABLE `users` ADD `display_name` text;--> statement-breakpoint
ALTER TABLE `users` ADD `email` text;--> statement-breakpoint
CREATE UNIQUE INDEX `users_entra_oid_unique` ON `users` (`entra_oid`);