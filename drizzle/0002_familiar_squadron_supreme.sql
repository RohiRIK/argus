CREATE INDEX `idx_baselines_job_metric_calc` ON `baselines` (`job_id`,`metric_name`,`calculated_at`);--> statement-breakpoint
CREATE INDEX `idx_executions_job_started` ON `executions` (`job_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `idx_executions_started` ON `executions` (`started_at`);--> statement-breakpoint
CREATE INDEX `idx_logs_execution` ON `logs` (`execution_id`,`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_logs_timestamp` ON `logs` (`timestamp`);