CREATE TABLE `approved_records` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`preview_id` text NOT NULL,
	`raw_json` text NOT NULL,
	`raw_hash` text NOT NULL,
	`derived_json` text NOT NULL,
	`preview_hash` text NOT NULL,
	`approved_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `records_owner_preview` ON `approved_records` (`owner_id`,`preview_id`);--> statement-breakpoint
CREATE TABLE `ingestion_previews` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`raw_json` text NOT NULL,
	`raw_hash` text NOT NULL,
	`derived_json` text,
	`preview_hash` text,
	`status` text NOT NULL,
	`error_code` text,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`provider_calls` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `previews_owner_idempotency` ON `ingestion_previews` (`owner_id`,`idempotency_key`);--> statement-breakpoint
CREATE TABLE `usage_reservations` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`utc_day` text NOT NULL,
	`created_at` text NOT NULL
);
