ALTER TABLE "test_instances" ALTER COLUMN "initiative_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "test_instances" ADD COLUMN "branch" text;--> statement-breakpoint
CREATE INDEX "test_instances_project_branch" ON "test_instances" USING btree ("project_id","branch","launched_at");