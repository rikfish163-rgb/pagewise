CREATE TABLE IF NOT EXISTS `learning_credits` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`kind` text NOT NULL,
	`credits` integer NOT NULL,
	`study_date` text NOT NULL,
	`created_at` integer NOT NULL,
	`source_id` text NOT NULL,
	CONSTRAINT "learning_credits_positive" CHECK("learning_credits"."credits" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `learning_credits_daily` ON `learning_credits` (`owner`,`study_date`,`kind`);