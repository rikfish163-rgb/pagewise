CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`course` text NOT NULL,
	`object_key` text NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `documents_owner` ON `documents` (`owner`);--> statement-breakpoint
CREATE TABLE `threads` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`doc_id` text NOT NULL,
	`page` integer NOT NULL,
	`selection_text` text,
	`image` text,
	`rect` text,
	`messages` text DEFAULT '[]' NOT NULL,
	`refs` text DEFAULT '[]' NOT NULL,
	`created` integer NOT NULL,
	FOREIGN KEY (`doc_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `threads_owner_doc` ON `threads` (`owner`,`doc_id`);