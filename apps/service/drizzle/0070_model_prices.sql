CREATE TABLE "model_prices" (
	"engine_id" text NOT NULL,
	"model" text NOT NULL,
	"input" numeric NOT NULL,
	"output" numeric NOT NULL,
	"cache_writes" numeric NOT NULL,
	"cache_reads" numeric NOT NULL,
	CONSTRAINT "model_prices_engine_id_model_pk" PRIMARY KEY("engine_id","model"),
	CONSTRAINT "model_prices_not_negative" CHECK ("model_prices"."input" >= 0 AND "model_prices"."output" >= 0 AND "model_prices"."cache_writes" >= 0 AND "model_prices"."cache_reads" >= 0)
);
