ALTER TABLE `templates` ADD `managed` integer;--> statement-breakpoint
ALTER TABLE `templates` ADD `source_hash` text;--> statement-breakpoint
UPDATE `templates` SET `managed` = 0 WHERE `is_default` = 0;
