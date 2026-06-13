CREATE TABLE `baselines` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`metric_name` text NOT NULL,
	`metric_value` real NOT NULL,
	`window_days` integer DEFAULT 7 NOT NULL,
	`calculated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `executions` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`status` text NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text,
	`records_processed` integer DEFAULT 0 NOT NULL,
	`graph_api_latency_ms` integer DEFAULT 0 NOT NULL,
	`error_message` text,
	`output_html` text,
	`email_sent` integer DEFAULT false NOT NULL,
	`email_recipients` text,
	`suppression_reason` text,
	`baseline_snapshot` text,
	`webhook_delivered` integer DEFAULT false NOT NULL,
	`webhook_error` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `integrations` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'disconnected' NOT NULL,
	`config` text DEFAULT '{}' NOT NULL,
	`last_health_check` text,
	`error_message` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `integrations_provider_unique` ON `integrations` (`provider`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`report_type` text NOT NULL,
	`params` text DEFAULT '{}' NOT NULL,
	`schedule_type` text NOT NULL,
	`schedule_preset` text,
	`cron_expression` text,
	`template_id` text,
	`recipients` text DEFAULT '[]' NOT NULL,
	`conditional_rules` text DEFAULT '{"mode":"always"}' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`template_id`) REFERENCES `templates`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `logs` (
	`id` text PRIMARY KEY NOT NULL,
	`execution_id` text NOT NULL,
	`level` text NOT NULL,
	`message` text NOT NULL,
	`timestamp` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`execution_id`) REFERENCES `executions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`id` text PRIMARY KEY NOT NULL,
	`master_key_hash` text,
	`global_recipients` text DEFAULT '[]' NOT NULL,
	`last_permission_check` text,
	`permission_status` text DEFAULT 'missing' NOT NULL,
	`language` text DEFAULT 'en' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `templates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`report_type` text DEFAULT 'generic' NOT NULL,
	`subject` text NOT NULL,
	`html_body` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`language` text DEFAULT 'en' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `vault` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`iv` text NOT NULL,
	`tag` text NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vault_key_unique` ON `vault` (`key`);--> statement-breakpoint
CREATE TABLE `webhooks` (
	`id` text PRIMARY KEY NOT NULL,
	`integration_id` text NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`secret` text,
	`include_full_html` integer DEFAULT true NOT NULL,
	`payload_template` text,
	`enabled` integer DEFAULT true NOT NULL,
	`last_delivery_status` text,
	`last_delivery_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`integration_id`) REFERENCES `integrations`(`id`) ON UPDATE no action ON DELETE cascade
);
