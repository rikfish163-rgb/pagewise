CREATE TABLE `study_note_counters` (
	`owner` text PRIMARY KEY NOT NULL,
	`last_number` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `study_note_sources` (
	`note_id` text NOT NULL,
	`source_key` text NOT NULL,
	`owner` text NOT NULL,
	`project` text NOT NULL,
	`doc_id` text,
	`document_name` text,
	`thread_id` text,
	`discussion_title` text,
	`page` integer,
	PRIMARY KEY(`note_id`, `source_key`),
	FOREIGN KEY (`note_id`) REFERENCES `study_notes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `study_note_sources_owner_thread` ON `study_note_sources` (`owner`,`thread_id`);--> statement-breakpoint
CREATE INDEX `study_note_sources_owner_project` ON `study_note_sources` (`owner`,`project`);--> statement-breakpoint
CREATE TABLE `study_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`number` integer NOT NULL,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`write_token` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "study_notes_number_positive" CHECK("study_notes"."number" BETWEEN 1 AND 999999999),
	CONSTRAINT "study_notes_revision_positive" CHECK("study_notes"."revision" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `study_notes_owner_number` ON `study_notes` (`owner`,`number`);--> statement-breakpoint
CREATE INDEX `study_notes_owner_updated` ON `study_notes` (`owner`,`updated_at`);
--> statement-breakpoint
-- The original notebook was initialized lazily rather than by Drizzle.
CREATE TABLE IF NOT EXISTS `notebooks` (
  `owner` text PRIMARY KEY NOT NULL,
  `body` text NOT NULL,
  `revision` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `study_notes` (`id`,`owner`,`number`,`title`,`body`,`revision`,`write_token`,`created_at`,`updated_at`)
SELECT 'legacy-notebook:' || `owner`, `owner`, 1, '原学习笔记', `body`, MAX(1,`revision`),
  'legacy-migration:' || `owner`, 0, 0
FROM `notebooks` WHERE length(`body`) > 0;
--> statement-breakpoint
INSERT INTO `study_note_counters` (`owner`,`last_number`)
SELECT `owner`, MAX(`number`) FROM `study_notes` GROUP BY `owner`;
