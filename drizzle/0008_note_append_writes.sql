-- Append idempotency ledger. A replayed requestId must not insert the same
-- block twice, even when another window appended in between and replaced the
-- note's last write token. text_hash lets a replay with different text fail
-- (409) instead of silently succeeding. Rows are kept for the life of the
-- note (deleted with it) so replay protection never expires.
CREATE TABLE `study_note_writes` (
	`owner` text NOT NULL,
	`note_id` text NOT NULL,
	`request_id` text NOT NULL,
	`text_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner`, `note_id`, `request_id`),
	FOREIGN KEY (`note_id`) REFERENCES `study_notes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `study_note_writes_note` ON `study_note_writes` (`owner`,`note_id`,`created_at`);
