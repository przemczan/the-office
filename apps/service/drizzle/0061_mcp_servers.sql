CREATE TABLE "mcp_servers" (
	"name" text PRIMARY KEY NOT NULL,
	"transport" text NOT NULL,
	"command" text,
	"arguments" jsonb,
	"url" text,
	"server_values" jsonb NOT NULL,
	"state" text NOT NULL,
	"added_at" timestamp with time zone NOT NULL,
	CONSTRAINT "mcp_servers_connection" CHECK (("mcp_servers"."transport" = 'stdio' AND "mcp_servers"."command" IS NOT NULL AND "mcp_servers"."arguments" IS NOT NULL AND "mcp_servers"."url" IS NULL) OR ("mcp_servers"."transport" = 'streamable-http' AND "mcp_servers"."url" IS NOT NULL AND "mcp_servers"."command" IS NULL AND "mcp_servers"."arguments" IS NULL)),
	CONSTRAINT "mcp_servers_state" CHECK ("mcp_servers"."state" IN ('on', 'off'))
);
