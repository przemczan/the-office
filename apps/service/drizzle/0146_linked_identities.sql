CREATE TABLE "linked_identities" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"subject" text NOT NULL,
	"name" text NOT NULL,
	"linked_at" timestamp with time zone NOT NULL,
	"last_signed_in_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "linked_identities" ADD CONSTRAINT "linked_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "linked_identities_provider_subject" ON "linked_identities" USING btree ("provider","subject");--> statement-breakpoint
CREATE UNIQUE INDEX "linked_identities_user_provider" ON "linked_identities" USING btree ("user_id","provider");