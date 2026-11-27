CREATE TABLE `alert_incidents` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`opened_at` text NOT NULL,
	`closed_at` text,
	`failure_count` integer DEFAULT 0 NOT NULL,
	`last_execution_id` text,
	`notify_status` text DEFAULT 'pending' NOT NULL,
	`notify_attempts` integer DEFAULT 0 NOT NULL,
	`last_attempt_at` text,
	`next_attempt_at` text,
	`last_error` text,
	`suppression_reason` text,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_alert_incidents_job` ON `alert_incidents` (`job_id`,`closed_at`);