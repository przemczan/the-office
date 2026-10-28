-- Proof of concept's Publish pushes the branch only (spec 2.3's proof-of-concept publish target).
UPDATE "pipelines"
SET "stages" = (
  SELECT jsonb_agg(
    CASE
      WHEN "stage"->>'key' = 'publish' AND "stage"->>'command' = 'publish'
        THEN "stage" || '{"publishTarget":"branch-only"}'::jsonb
      ELSE "stage"
    END
    ORDER BY "position"
  )
  FROM jsonb_array_elements("pipelines"."stages") WITH ORDINALITY AS "stages_in_order"("stage", "position")
)
WHERE "id" = 'proof-of-concept';
--> statement-breakpoint
-- Onboard publishes Devops' fixes by the Project's publishing mode, unless the user gave it a Publish already.
UPDATE "pipelines"
SET "stages" = "stages" || '[{"kind":"script","key":"publish","name":"Publish","command":"publish","optional":false}]'::jsonb
WHERE "id" = 'onboard'
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements("pipelines"."stages") AS "onboard_stages"("stage")
    WHERE "stage"->>'command' = 'publish' OR "stage"->>'key' = 'publish'
  );
--> statement-breakpoint
UPDATE "pipelines"
SET "description" = 'Prepares a Project on the workstation until it builds and tests in a fresh worktree, then publishes the fixes.'
WHERE "id" = 'onboard'
  AND "description" = 'Prepares a Project on the workstation until it builds and tests in a fresh worktree.';
