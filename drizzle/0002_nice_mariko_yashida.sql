CREATE TABLE `workflow_approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`submission_id` text NOT NULL,
	`revision` integer NOT NULL,
	`reviewer_id` text NOT NULL,
	`approval_hash` text NOT NULL,
	`binding_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workflow_approval_revision` ON `workflow_approvals` (`submission_id`,`revision`);--> statement-breakpoint
CREATE TABLE `workflow_events` (
	`id` text PRIMARY KEY NOT NULL,
	`submission_id` text,
	`job_id` text,
	`revision` integer DEFAULT 0 NOT NULL,
	`actor_id` text NOT NULL,
	`kind` text NOT NULL,
	`event_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workflow_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`submission_id` text NOT NULL,
	`revision` integer NOT NULL,
	`approval_id` text NOT NULL,
	`status` text NOT NULL,
	`operation_hash` text NOT NULL,
	`manifest_json` text NOT NULL,
	`verification_json` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workflow_job_approval` ON `workflow_jobs` (`approval_id`);--> statement-breakpoint
CREATE TABLE `workflow_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`action` text NOT NULL,
	`request_hash` text NOT NULL,
	`result_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workflow_actor_key` ON `workflow_receipts` (`actor_id`,`idempotency_key`);--> statement-breakpoint
CREATE TABLE `workflow_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`submission_id` text NOT NULL,
	`revision` integer NOT NULL,
	`actor_id` text NOT NULL,
	`raw_json` text NOT NULL,
	`raw_hash` text NOT NULL,
	`payload_hash` text NOT NULL,
	`diff_hash` text NOT NULL,
	`preview_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workflow_revision_number` ON `workflow_revisions` (`submission_id`,`revision`);--> statement-breakpoint
CREATE TABLE `workflow_submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`current_revision` integer NOT NULL,
	`review_state` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workflow_targets` (
	`record_id` text PRIMARY KEY NOT NULL,
	`version` integer NOT NULL,
	`record_hash` text NOT NULL,
	`job_id` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workflow_task_events` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`version` integer NOT NULL,
	`actor_id` text NOT NULL,
	`event_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workflow_task_version` ON `workflow_task_events` (`task_id`,`version`);