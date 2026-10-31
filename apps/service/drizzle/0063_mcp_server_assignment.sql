CREATE TABLE "project_server_values" (
	"project_id" text NOT NULL,
	"server_name" text NOT NULL,
	"name" text NOT NULL,
	"value" text NOT NULL,
	"secret" boolean NOT NULL,
	CONSTRAINT "project_server_values_project_id_server_name_name_pk" PRIMARY KEY("project_id","server_name","name")
);
--> statement-breakpoint
CREATE TABLE "role_mcp_servers" (
	"role_key" text NOT NULL,
	"server_name" text NOT NULL,
	CONSTRAINT "role_mcp_servers_role_key_server_name_pk" PRIMARY KEY("role_key","server_name")
);
--> statement-breakpoint
CREATE TABLE "session_mcp_servers" (
	"session_id" text PRIMARY KEY NOT NULL,
	"project_id" text,
	"servers" jsonb NOT NULL,
	"prepared_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_server_values" ADD CONSTRAINT "project_server_values_server_name_mcp_servers_name_fk" FOREIGN KEY ("server_name") REFERENCES "public"."mcp_servers"("name") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_mcp_servers" ADD CONSTRAINT "role_mcp_servers_server_name_mcp_servers_name_fk" FOREIGN KEY ("server_name") REFERENCES "public"."mcp_servers"("name") ON DELETE cascade ON UPDATE no action;