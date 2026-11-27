CREATE TABLE `site_email_challenges` (
	`browser_hash` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`code_hash` text NOT NULL,
	`return_to` text NOT NULL,
	`legacy_owner` text,
	`sent_at` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`consumed` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `site_email_challenges_sent` ON `site_email_challenges` (`sent_at`);--> statement-breakpoint
CREATE INDEX `site_email_challenges_email_sent` ON `site_email_challenges` (`email`,`sent_at`);