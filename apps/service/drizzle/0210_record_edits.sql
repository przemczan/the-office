CREATE TABLE "record_edits" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "record_edits_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"record_kind" text NOT NULL,
	"record_id" uuid NOT NULL,
	"field" text NOT NULL,
	"edited_at" timestamp with time zone NOT NULL,
	"edited_by" jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX "record_edits_record" ON "record_edits" USING btree ("record_kind","record_id");