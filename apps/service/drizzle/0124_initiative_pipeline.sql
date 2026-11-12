ALTER TABLE "initiatives" ADD COLUMN "pipeline_id" text;--> statement-breakpoint
ALTER TABLE "initiatives" ADD COLUMN "short_name" text;--> statement-breakpoint
ALTER TABLE "initiatives" ADD COLUMN "branches" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "initiatives_short_name_unique" ON "initiatives" USING btree ("short_name") WHERE "initiatives"."short_name" is not null;