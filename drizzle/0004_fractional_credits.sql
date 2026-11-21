CREATE TABLE `credit_settlement_guard` (
	`rejected` integer NOT NULL,
	CONSTRAINT "credit_settlement_requires_live_hold" CHECK(0)
);
--> statement-breakpoint
CREATE TABLE `model_credit_expenses` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`request_id` text NOT NULL,
	`credits_milli` integer NOT NULL,
	`created_at` integer NOT NULL,
	`study_date` text NOT NULL,
	`source_id` text NOT NULL,
	`detail` text NOT NULL,
	`kind` text DEFAULT 'site_answer' NOT NULL,
	CONSTRAINT "model_credit_expenses_debit" CHECK(typeof("model_credit_expenses"."credits_milli") = 'integer' AND "model_credit_expenses"."credits_milli" <= 0),
	CONSTRAINT "model_credit_expenses_kind" CHECK("model_credit_expenses"."kind" IN ('site_answer','site_memory'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `model_credit_expenses_request` ON `model_credit_expenses` (`owner`,`request_id`);--> statement-breakpoint
CREATE INDEX `model_credit_expenses_owner_date` ON `model_credit_expenses` (`owner`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `site_model_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`operation_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`outcome` text NOT NULL,
	`detail` text NOT NULL,
	CONSTRAINT "site_model_usage_outcome" CHECK("site_model_usage"."outcome" IN ('completed','failed'))
);
--> statement-breakpoint
CREATE INDEX `site_model_usage_owner_operation` ON `site_model_usage` (`owner`,`operation_id`);--> statement-breakpoint
ALTER TABLE `credit_requests` ADD `reserved_milli` integer DEFAULT 0;