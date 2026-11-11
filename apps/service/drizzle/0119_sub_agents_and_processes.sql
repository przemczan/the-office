CREATE TABLE "process_output" (
	"session_id" text NOT NULL,
	"call_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"text" text NOT NULL,
	CONSTRAINT "process_output_session_id_call_id_sequence_pk" PRIMARY KEY("session_id","call_id","sequence")
);
--> statement-breakpoint
CREATE TABLE "sub_agent_messages" (
	"session_id" text NOT NULL,
	"call_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"body" jsonb NOT NULL,
	CONSTRAINT "sub_agent_messages_session_id_call_id_sequence_pk" PRIMARY KEY("session_id","call_id","sequence")
);
--> statement-breakpoint
CREATE TABLE "sub_agents_and_processes" (
	"session_id" text NOT NULL,
	"call_id" text NOT NULL,
	"thread_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"engine_task_id" text,
	"started_by" text,
	"description" text NOT NULL,
	"ending" jsonb,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"revision" integer NOT NULL,
	"last_sequence" integer DEFAULT 0 NOT NULL,
	"agent_kind" text,
	"prompt" text,
	"background" boolean,
	"reported_back" text,
	"tool_call_count" integer,
	"total_tokens" integer,
	"earlier_messages_not_kept" integer DEFAULT 0 NOT NULL,
	"command_line" text,
	"exit_code" integer,
	"kept_bytes" integer DEFAULT 0 NOT NULL,
	"earlier_output_not_kept" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "sub_agents_and_processes_session_id_call_id_pk" PRIMARY KEY("session_id","call_id")
);
--> statement-breakpoint
ALTER TABLE "process_output" ADD CONSTRAINT "process_output_session_id_call_id_sub_agents_and_processes_session_id_call_id_fk" FOREIGN KEY ("session_id","call_id") REFERENCES "public"."sub_agents_and_processes"("session_id","call_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sub_agent_messages" ADD CONSTRAINT "sub_agent_messages_session_id_call_id_sub_agents_and_processes_session_id_call_id_fk" FOREIGN KEY ("session_id","call_id") REFERENCES "public"."sub_agents_and_processes"("session_id","call_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sub_agents_and_processes" ADD CONSTRAINT "sub_agents_and_processes_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sub_agents_and_processes_thread" ON "sub_agents_and_processes" USING btree ("thread_id");