import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  real,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// detections — one row per interception per hop
// ---------------------------------------------------------------------------
export const detections = pgTable(
  "detections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    session_id: text("session_id").notNull(),
    hop: integer("hop").notNull(),
    agent_id: text("agent_id").notNull(),
    source_url: text("source_url"),
    source_type: text("source_type"),

    // Defender result fields
    tier2_score: real("tier2_score"), // 0.0–1.0, null if Tier 2 skipped
    allowed: boolean("allowed").notNull(),
    risk_level: text("risk_level"), // diagnostic only — never used for routing
    detections: text("detections").array().notNull().default(sql`'{}'::text[]`),
    fields_sanitized: text("fields_sanitized")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    max_sentence: text("max_sentence"),

    // Content identity
    content_hash_received: text("content_hash_received").notNull(),
    content_hash_sanitized: text("content_hash_sanitized"), // null if Tier 1 made no changes

    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("detections_session_id_idx").on(t.session_id),
    index("detections_session_hop_idx").on(t.session_id, t.hop),
  ],
);

// ---------------------------------------------------------------------------
// verdicts — one row per Judge LLM batch evaluation
// ---------------------------------------------------------------------------
export const verdicts = pgTable(
  "verdicts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    session_id: text("session_id").notNull(),
    detection_ids: uuid("detection_ids").array().notNull(),

    // Judge LLM output
    verdict: text("verdict", {
      enum: ["injection", "benign", "uncertain"],
    }).notNull(),
    confidence: real("confidence").notNull(), // 0.0–1.0
    attack_type: text("attack_type"), // null for benign/uncertain
    novelty_flag: boolean("novelty_flag").notNull().default(false),
    reasoning: text("reasoning").notNull(),
    behavioral_fingerprint: text("behavioral_fingerprint"), // null if novelty_flag = false
    session_summary: text("session_summary").notNull(), // 2–3 sentences, rolling

    // Computed flags
    defender_judge_disagree: boolean("defender_judge_disagree")
      .notNull()
      .default(false),

    // requires_review is a Postgres GENERATED ALWAYS AS column.
    // True when: confidence < 0.85 OR novelty_flag = true OR defender_judge_disagree = true.
    // Never set manually — Postgres recomputes on every INSERT/UPDATE.
    requires_review: boolean("requires_review").generatedAlwaysAs(
      sql`(confidence < 0.85 OR novelty_flag = true OR defender_judge_disagree = true)`,
    ),

    // Flywheel / human review lifecycle
    fed_to_flywheel: boolean("fed_to_flywheel").notNull().default(false),
    human_reviewed: boolean("human_reviewed").notNull().default(false),

    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("verdicts_session_id_idx").on(t.session_id),
    index("verdicts_flywheel_idx").on(
      t.fed_to_flywheel,
      t.requires_review,
      t.human_reviewed,
    ),
  ],
);

// ---------------------------------------------------------------------------
// agent_actions — one row per tool call per hop
// ---------------------------------------------------------------------------
export const agent_actions = pgTable(
  "agent_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    session_id: text("session_id").notNull(),
    hop: integer("hop").notNull(),
    agent_id: text("agent_id").notNull(),
    tool_name: text("tool_name").notNull(),
    // created_at preserves action sequence within a hop — order ASC to reconstruct
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("agent_actions_session_hop_idx").on(t.session_id, t.hop)],
);
