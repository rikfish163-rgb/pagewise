CREATE TABLE `memory_evidence` (
	`owner` text NOT NULL,
	`thread_id` text NOT NULL,
	`turn` integer NOT NULL,
	`topic_key` text,
	`topic` text,
	`detail` text,
	`kind` text,
	`asked_at` integer NOT NULL,
	PRIMARY KEY(`owner`, `thread_id`, `turn`),
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `memory_evidence_thread` ON `memory_evidence` (`thread_id`);--> statement-breakpoint
CREATE TABLE `memory_jobs` (
	`owner` text NOT NULL,
	`course` text NOT NULL,
	`token` text NOT NULL,
	`expires_at` integer NOT NULL,
	`samples` text NOT NULL,
	PRIMARY KEY(`owner`, `course`)
);
--> statement-breakpoint
CREATE TABLE `memory_mastery` (
	`owner` text NOT NULL,
	`course` text NOT NULL,
	`topic_key` text NOT NULL,
	PRIMARY KEY(`owner`, `course`, `topic_key`)
);
