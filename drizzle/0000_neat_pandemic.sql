CREATE TABLE "agent_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" text NOT NULL,
	"hop" integer NOT NULL,
	"agent_id" text NOT NULL,
	"tool_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "detections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" text NOT NULL,
	"hop" integer NOT NULL,
	"agent_id" text NOT NULL,
	"source_url" text,
	"source_type" text,
	"tier2_score" real,
	"allowed" boolean NOT NULL,
	"risk_level" text,
	"detections" text[] DEFAULT '{}'::text[] NOT NULL,
	"fields_sanitized" text[] DEFAULT '{}'::text[] NOT NULL,
	"max_sentence" text,
	"content_hash_received" text NOT NULL,
	"content_hash_sanitized" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verdicts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" text NOT NULL,
	"detection_ids" uuid[] NOT NULL,
	"verdict" text NOT NULL,
	"confidence" real NOT NULL,
	"attack_type" text,
	"novelty_flag" boolean DEFAULT false NOT NULL,
	"reasoning" text NOT NULL,
	"behavioral_fingerprint" text,
	"session_summary" text NOT NULL,
	"defender_judge_disagree" boolean DEFAULT false NOT NULL,
	"requires_review" boolean GENERATED ALWAYS AS ((confidence < 0.85 OR novelty_flag = true OR defender_judge_disagree = true)) STORED,
	"fed_to_flywheel" boolean DEFAULT false NOT NULL,
	"human_reviewed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "agent_actions_session_hop_idx" ON "agent_actions" USING btree ("session_id","hop");--> statement-breakpoint
CREATE INDEX "detections_session_id_idx" ON "detections" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "detections_session_hop_idx" ON "detections" USING btree ("session_id","hop");--> statement-breakpoint
CREATE INDEX "verdicts_session_id_idx" ON "verdicts" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "verdicts_flywheel_idx" ON "verdicts" USING btree ("fed_to_flywheel","requires_review","human_reviewed");