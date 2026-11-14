ALTER TABLE "stage_runs" ADD COLUMN "role_key" text;
--> statement-breakpoint
-- The built-in Pipelines and Stage templates name duties instead of Roles (spec §2.3, "Built-ins"):
-- each built-in Agent Stage still naming its built-in Role names the duty that Role holds by
-- default. Stages the user gave another Role, Pipelines and templates the user made, and Tasks'
-- own Stages stay as they are.
UPDATE "pipelines"
SET "stages" = (
  SELECT coalesce(jsonb_agg(
    CASE
      WHEN "stage" ->> 'kind' = 'agent' AND "stage" ->> 'key' IN ('implement', 'review-and-fix', 'produce') AND "stage" ->> 'role' = 'developer'
        THEN ("stage" - 'role') || '{"duty":"implements"}'::jsonb
      WHEN "stage" ->> 'kind' = 'agent' AND "stage" ->> 'key' IN ('onboard', 'set-up') AND "stage" ->> 'role' = 'devops'
        THEN ("stage" - 'role') || '{"duty":"onboards-projects"}'::jsonb
      ELSE "stage" END
    ORDER BY "position"), '[]'::jsonb)
  FROM jsonb_array_elements("pipelines"."stages") WITH ORDINALITY AS "stages"("stage", "position")
)
WHERE "id" IN ('full', 'quick-fix', 'document', 'onboard', 'proof-of-concept', 'set-up-run-environment');
--> statement-breakpoint
UPDATE "stage_templates"
SET "stage" = ("stage" - 'role') || '{"duty":"implements"}'::jsonb
WHERE "id" IN ('implement', 'review-and-fix', 'produce') AND "stage" ->> 'kind' = 'agent' AND "stage" ->> 'role' = 'developer';
--> statement-breakpoint
UPDATE "stage_templates"
SET "stage" = ("stage" - 'role') || '{"duty":"onboards-projects"}'::jsonb
WHERE "id" IN ('onboard', 'set-up') AND "stage" ->> 'kind' = 'agent' AND "stage" ->> 'role' = 'devops';
