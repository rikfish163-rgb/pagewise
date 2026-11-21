CREATE TABLE `admin_credit_adjustments` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`admin_owner` text NOT NULL,
	`request_id` text NOT NULL,
	`delta_milli` integer NOT NULL,
	`reason` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "admin_credit_adjustments_signed" CHECK(typeof("admin_credit_adjustments"."delta_milli") = 'integer' AND "admin_credit_adjustments"."delta_milli" != 0 AND "admin_credit_adjustments"."delta_milli" BETWEEN -9007199254740991 AND 9007199254740991),
	CONSTRAINT "admin_credit_adjustments_reason" CHECK(length(trim("admin_credit_adjustments"."reason")) BETWEEN 1 AND 500)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `admin_credit_adjustments_request` ON `admin_credit_adjustments` (`admin_owner`,`request_id`);--> statement-breakpoint
CREATE INDEX `admin_credit_adjustments_owner_date` ON `admin_credit_adjustments` (`owner`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `admin_credit_adjustments_date` ON `admin_credit_adjustments` (`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `site_accounts` (
	`owner` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`email` text,
	`created_at` integer NOT NULL,
	`last_seen` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `site_accounts_email` ON `site_accounts` (`email`);--> statement-breakpoint
CREATE TABLE `site_external_identities` (
	`issuer` text NOT NULL,
	`subject` text NOT NULL,
	`owner` text NOT NULL,
	PRIMARY KEY(`issuer`, `subject`),
	FOREIGN KEY (`owner`) REFERENCES `site_accounts`(`owner`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `site_external_identities_owner` ON `site_external_identities` (`owner`);--> statement-breakpoint
CREATE TABLE `site_login_transactions` (
	`state_hash` text PRIMARY KEY NOT NULL,
	`browser_hash` text NOT NULL,
	`code_verifier` text NOT NULL,
	`nonce` text NOT NULL,
	`intent` text NOT NULL,
	`legacy_owner` text,
	`return_to` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `site_login_transactions_expiry` ON `site_login_transactions` (`expires_at`);--> statement-breakpoint
CREATE INDEX `site_login_transactions_browser` ON `site_login_transactions` (`browser_hash`);--> statement-breakpoint
CREATE TABLE `site_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`owner`) REFERENCES `site_accounts`(`owner`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `site_sessions_expiry` ON `site_sessions` (`expires_at`);
--> statement-breakpoint
CREATE TRIGGER `admin_credit_adjustments_no_update`
BEFORE UPDATE ON `admin_credit_adjustments`
BEGIN
	SELECT RAISE(ABORT, 'admin credit adjustments are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `admin_credit_adjustments_no_delete`
BEFORE DELETE ON `admin_credit_adjustments`
BEGIN
	SELECT RAISE(ABORT, 'admin credit adjustments are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `admin_credit_adjustments_no_replace`
BEFORE INSERT ON `admin_credit_adjustments`
WHEN EXISTS (
	SELECT 1 FROM `admin_credit_adjustments`
	WHERE `id` = NEW.`id` OR (`admin_owner` = NEW.`admin_owner` AND `request_id` = NEW.`request_id`)
)
BEGIN
	SELECT RAISE(ABORT, 'admin credit adjustments are immutable');
END;
