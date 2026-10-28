CREATE TABLE "initiatives" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"outcome" text NOT NULL,
	"state" text NOT NULL,
	"origin_idea_id" uuid NOT NULL,
	"created_by" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attachments" DROP CONSTRAINT "attachments_one_owner";--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "initiative_id" uuid;--> statement-breakpoint
ALTER TABLE "ideas" ADD COLUMN "initiative_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "initiative_id" uuid;--> statement-breakpoint
ALTER TABLE "initiatives" ADD CONSTRAINT "initiatives_origin_idea_id_ideas_id_fk" FOREIGN KEY ("origin_idea_id") REFERENCES "public"."ideas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_initiative_id_initiatives_id_fk" FOREIGN KEY ("initiative_id") REFERENCES "public"."initiatives"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_initiative_id_initiatives_id_fk" FOREIGN KEY ("initiative_id") REFERENCES "public"."initiatives"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_initiative_id_initiatives_id_fk" FOREIGN KEY ("initiative_id") REFERENCES "public"."initiatives"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachments_initiative" ON "attachments" USING btree ("initiative_id");--> statement-breakpoint
CREATE INDEX "tasks_initiative" ON "tasks" USING btree ("initiative_id");--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_one_owner" CHECK (num_nonnulls("attachments"."idea_id", "attachments"."initiative_id", "attachments"."task_id") = 1);