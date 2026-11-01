CREATE TABLE "engine_day_usage" (
	"day" date NOT NULL,
	"engine_id" text NOT NULL,
	"model" text NOT NULL,
	"input" bigint NOT NULL,
	"output" bigint NOT NULL,
	"cache_read" bigint NOT NULL,
	"cache_creation" bigint NOT NULL,
	CONSTRAINT "engine_day_usage_day_engine_id_model_pk" PRIMARY KEY("day","engine_id","model")
);
