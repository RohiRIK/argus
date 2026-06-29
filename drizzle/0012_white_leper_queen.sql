CREATE TABLE `execution_rows` (
	`id` text PRIMARY KEY NOT NULL,
	`execution_id` text NOT NULL,
	`job_id` text NOT NULL,
	`row_key` text NOT NULL,
	`row_data` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`execution_id`) REFERENCES `executions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_execution_rows_job_created` ON `execution_rows` (`job_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_execution_rows_execution` ON `execution_rows` (`execution_id`);