-- A run keeps the question of the Decision its Agent opened, which the Stage's next run is told was answered. The Agent's Decisions kept so far belong to runs that ended needing them, whose outcome holds the question.
UPDATE "stage_runs"
SET "decisions" = (
  SELECT jsonb_agg(
    CASE
      WHEN "decision" ->> 'kind' = 'agent'
        THEN "decision" || jsonb_build_object('question', "stage_runs"."outcome" ->> 'question')
      ELSE "decision"
    END
    ORDER BY "position"
  )
  FROM jsonb_array_elements("stage_runs"."decisions") WITH ORDINALITY AS "kept" ("decision", "position")
)
WHERE "outcome" ->> 'status' = 'needs-decision'
  AND jsonb_array_length("decisions") > 0;
