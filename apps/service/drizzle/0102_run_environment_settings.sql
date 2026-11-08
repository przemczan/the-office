CREATE TABLE "run_environment_settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"cpus" real NOT NULL,
	"memory_megabytes" integer NOT NULL,
	"processes" integer NOT NULL,
	"run_environments_at_once" integer NOT NULL,
	CONSTRAINT "run_environment_settings_one_row" CHECK ("run_environment_settings"."id" = 1),
	CONSTRAINT "run_environment_settings_cpus" CHECK ("run_environment_settings"."cpus" > 0),
	CONSTRAINT "run_environment_settings_memory" CHECK ("run_environment_settings"."memory_megabytes" > 0),
	CONSTRAINT "run_environment_settings_processes" CHECK ("run_environment_settings"."processes" > 0),
	CONSTRAINT "run_environment_settings_at_once" CHECK ("run_environment_settings"."run_environments_at_once" > 0)
);
