CREATE TABLE `credit_expenses` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`request_id` text NOT NULL,
	`credits` integer NOT NULL,
	`created_at` integer NOT NULL,
	`study_date` text NOT NULL,
	`source_id` text NOT NULL,
	`detail` text NOT NULL,
	CONSTRAINT "credit_expenses_one" CHECK("credit_expenses"."credits"=-1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `credit_expenses_request` ON `credit_expenses` (`owner`,`request_id`);--> statement-breakpoint
CREATE INDEX `credit_expenses_owner_date` ON `credit_expenses` (`owner`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `credit_income` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`credits` integer DEFAULT 10 NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "credit_income_ten" CHECK("credit_income"."credits"=10)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `credit_income_owner_unique` ON `credit_income` (`owner`);--> statement-breakpoint
CREATE TABLE `credit_requests` (
	`owner` text NOT NULL,
	`request_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`reserved` integer DEFAULT 0 NOT NULL,
	`token` text NOT NULL,
	`expires_at` integer NOT NULL,
	`response` text,
	PRIMARY KEY(`owner`, `request_id`),
	CONSTRAINT "credit_requests_reserved" CHECK("credit_requests"."reserved" IN (0,1))
);
--> statement-breakpoint
CREATE INDEX `learning_credits_owner_date` ON `learning_credits` (`owner`,`created_at`,`id`);