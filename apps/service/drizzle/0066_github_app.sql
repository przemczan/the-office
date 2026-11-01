CREATE TABLE "github_app" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"client_id" text NOT NULL,
	"slug" text NOT NULL,
	"owner" text NOT NULL,
	CONSTRAINT "github_app_one_row" CHECK ("github_app"."id" = 1)
);
