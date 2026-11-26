CREATE TABLE `automation_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`policy_id` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`target_label` text NOT NULL,
	`action_type` text NOT NULL,
	`status` text NOT NULL,
	`reason` text NOT NULL,
	`before_state` text DEFAULT '{}' NOT NULL,
	`after_state` text,
	`rollback_payload` text,
	`error_message` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `automation_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`policy_id`) REFERENCES `automation_policies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_automation_actions_run` ON `automation_actions` (`run_id`);--> statement-breakpoint
CREATE INDEX `idx_automation_actions_policy` ON `automation_actions` (`policy_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `automation_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`level` text NOT NULL,
	`message` text NOT NULL,
	`timestamp` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `automation_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_automation_logs_run` ON `automation_logs` (`run_id`,`timestamp`);--> statement-breakpoint
CREATE TABLE `automation_policies` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`automation_type` text NOT NULL,
	`mode` text DEFAULT 'audit' NOT NULL,
	`params` text DEFAULT '{}' NOT NULL,
	`schedule_type` text DEFAULT 'preset' NOT NULL,
	`schedule_preset` text,
	`cron_expression` text,
	`recipients` text DEFAULT '[]' NOT NULL,
	`recipient_group_ids` text DEFAULT '[]' NOT NULL,
	`notify_on` text DEFAULT 'changes_only' NOT NULL,
	`max_actions_per_run` integer DEFAULT 25 NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`snoozed_until` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `automation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`policy_id` text NOT NULL,
	`mode` text NOT NULL,
	`trigger` text DEFAULT 'manual' NOT NULL,
	`status` text NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text,
	`evaluated_count` integer DEFAULT 0 NOT NULL,
	`planned_count` integer DEFAULT 0 NOT NULL,
	`applied_count` integer DEFAULT 0 NOT NULL,
	`failed_count` integer DEFAULT 0 NOT NULL,
	`graph_api_latency_ms` integer DEFAULT 0 NOT NULL,
	`error_message` text,
	`summary_text` text,
	`output_html` text,
	`email_sent` integer DEFAULT false NOT NULL,
	`email_recipients` text,
	`webhook_delivered` integer DEFAULT false NOT NULL,
	`webhook_error` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`policy_id`) REFERENCES `automation_policies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_automation_runs_policy_started` ON `automation_runs` (`policy_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `idx_automation_runs_started` ON `automation_runs` (`started_at`);