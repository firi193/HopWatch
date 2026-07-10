import { z } from "zod";

// ---------------------------------------------------------------------------
// What we ask Gemini to produce (defender_judge_disagree is computed by us)
// ---------------------------------------------------------------------------
export const GeminiVerdictSchema = z.object({
  verdict: z.enum(["injection", "benign", "uncertain"]),
  confidence: z.number().min(0).max(1),
  attack_type: z.string().nullable(),
  novelty_flag: z.boolean(),
  reasoning: z.string(),
  behavioral_fingerprint: z.string().nullable(),
  session_summary: z.string(),
});

export type GeminiVerdict = z.infer<typeof GeminiVerdictSchema>;

// ---------------------------------------------------------------------------
// Full verdict stored in Postgres (adds computed defender_judge_disagree)
// ---------------------------------------------------------------------------
export const VerdictSchema = GeminiVerdictSchema.extend({
  defender_judge_disagree: z.boolean(),
});

export type Verdict = z.infer<typeof VerdictSchema>;

// ---------------------------------------------------------------------------
// Static Gemini responseSchema (OpenAPI Schema Object format).
// Mirrors GeminiVerdictSchema — update here if the Zod schema changes.
// defender_judge_disagree is intentionally excluded (computed post-LLM).
// ---------------------------------------------------------------------------
export const geminiResponseSchema = {
  type: "object",
  properties: {
    verdict: {
      type: "string",
      enum: ["injection", "benign", "uncertain"],
    },
    confidence: { type: "number" },
    attack_type: { type: "string", nullable: true },
    novelty_flag: { type: "boolean" },
    reasoning: { type: "string" },
    behavioral_fingerprint: { type: "string", nullable: true },
    session_summary: { type: "string" },
  },
  required: [
    "verdict",
    "confidence",
    "attack_type",
    "novelty_flag",
    "reasoning",
    "behavioral_fingerprint",
    "session_summary",
  ],
};
