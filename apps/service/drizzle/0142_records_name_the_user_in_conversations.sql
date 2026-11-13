ALTER TABLE "office_instructions_versions" ADD COLUMN "saved_by" jsonb;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "status_by" jsonb;--> statement-breakpoint
-- What only the user did before this was kept names no user (null) until the first user claims it.
UPDATE "thread_messages" SET "body" = "body" || '{"writtenBy":null}'::jsonb WHERE "body" ->> 'kind' = 'user';--> statement-breakpoint
UPDATE "thread_messages" SET "body" = "body" || '{"by":null}'::jsonb WHERE "body" ->> 'kind' = 'changes-allowed';--> statement-breakpoint
UPDATE "thread_messages" SET "body" = jsonb_set("body", '{atUsersRequest,user}', 'null'::jsonb) WHERE "body" ->> 'kind' = 'decision-answer' AND "body" -> 'atUsersRequest' IS NOT NULL;--> statement-breakpoint
-- An answer the user gave themselves records none of who else gave it.
UPDATE "decisions" SET "answer" = "answer" || '{"user":null}'::jsonb WHERE "answer" IS NOT NULL AND "answer" -> 'answeredBy' IS NULL AND "answer" -> 'atUsersRequest' IS NULL AND "answer" -> 'byTheOffice' IS NULL;--> statement-breakpoint
UPDATE "decisions" SET "answer" = jsonb_set("answer", '{atUsersRequest,user}', 'null'::jsonb) WHERE "answer" -> 'atUsersRequest' IS NOT NULL;
