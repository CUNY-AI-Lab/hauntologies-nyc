ALTER TABLE `usage_reservations` ADD `budget_window` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `usage_reservations` ADD `budget_microdollars` integer DEFAULT 0 NOT NULL;