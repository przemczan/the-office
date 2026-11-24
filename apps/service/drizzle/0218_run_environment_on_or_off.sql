ALTER TABLE "projects" ALTER COLUMN "run_environment" SET DEFAULT 'off';--> statement-breakpoint
-- Not decided yet is gone: a Project not decided ran its checks on the host, as Off does.
UPDATE "projects" SET "run_environment" = 'off' WHERE "run_environment" = 'not-decided';
