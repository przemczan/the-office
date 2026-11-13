CREATE TABLE "signed_in_devices" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"user_agent" text,
	"address_kind" text NOT NULL,
	"signed_in_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "signed_in_devices_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "signed_in_devices_address_kind" CHECK ("signed_in_devices"."address_kind" IN ('localhost', 'loopback-ip', 'local-network-ip', 'public'))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"wrong_tries_in_a_row" integer DEFAULT 0 NOT NULL,
	"next_try_at" timestamp with time zone,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "signed_in_devices" ADD CONSTRAINT "signed_in_devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "signed_in_devices_user" ON "signed_in_devices" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree (lower("email"));