CREATE TABLE "engine_model_lists" (
	"engine_id" text PRIMARY KEY NOT NULL,
	"models" jsonb NOT NULL,
	"listed_at" timestamp with time zone NOT NULL
);
