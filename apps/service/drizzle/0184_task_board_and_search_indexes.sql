-- An array's words joined as array_to_string does, which is only stable, declared immutable so the search index can read it: text arrays print the same whatever the settings.
CREATE OR REPLACE FUNCTION office_words(words text[]) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE RETURN array_to_string(words, ' ');--> statement-breakpoint
CREATE INDEX "tasks_board_order" ON "tasks" USING btree ((CASE "priority" WHEN 'high' THEN 0 WHEN 'normal' THEN 1 WHEN 'low' THEN 2 END),("order_key" COLLATE "C"),"id") WHERE "tasks"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX "tasks_search" ON "tasks" USING gin ((setweight(to_tsvector('simple', regexp_replace("title", '[[:punct:][:space:]]+', ' ', 'g')), 'A')
  || to_tsvector('simple', regexp_replace(left("description" || ' ' || "plan" || ' '
    || office_words("definition_of_done") || ' '
    || office_words("tags") || ' ' || "kind", 262144), '[[:punct:][:space:]]+', ' ', 'g'))));