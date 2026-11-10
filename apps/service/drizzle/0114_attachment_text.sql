-- Whether a file is a text file. A document always is; every other file is judged from its bytes at
-- the next start (AttachmentService.judgeFilesAttachedBefore), and a link stays null.
ALTER TABLE "attachments" ADD COLUMN "text" boolean;--> statement-breakpoint
UPDATE "attachments" SET "text" = true WHERE "kind" = 'document';
