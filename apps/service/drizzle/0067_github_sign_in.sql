CREATE TABLE "github_sign_in" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"login" text,
	"access_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token" text,
	"refresh_token_expires_at" timestamp with time zone,
	"signed_out_reason" text,
	CONSTRAINT "github_sign_in_one_row" CHECK ("github_sign_in"."id" = 1),
	CONSTRAINT "github_sign_in_signed_in_or_out" CHECK (("github_sign_in"."login" is not null and "github_sign_in"."access_token" is not null and "github_sign_in"."signed_out_reason" is null)
        or ("github_sign_in"."login" is null and "github_sign_in"."access_token" is null and "github_sign_in"."refresh_token" is null
          and "github_sign_in"."signed_out_reason" is not null))
);
--> statement-breakpoint
-- An App kept without its client secret can't exchange a sign-in's code: the user registers it again.
DELETE FROM "github_app";--> statement-breakpoint
ALTER TABLE "github_app" ADD COLUMN "client_secret" text NOT NULL;