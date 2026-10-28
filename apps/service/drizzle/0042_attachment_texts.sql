CREATE TABLE "attachment_texts" (
	"attachment_id" uuid PRIMARY KEY NOT NULL,
	"text" text NOT NULL,
	"search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', regexp_replace("attachment_texts"."text", '[[:punct:][:space:]]+', ' ', 'g'))) STORED NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attachment_texts" ADD CONSTRAINT "attachment_texts_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE cascade ON UPDATE no action;