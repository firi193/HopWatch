import { eq, desc } from "drizzle-orm";
import { db } from "../db/index.js";
import { verdicts } from "../db/schema.js";
import { redis } from "../lib/redis.js";
import { logger } from "../lib/logger.js";
import { TIER2_HIGH_THRESHOLD } from "../queue/constants.js";
import type { DetectionQueuePayload } from "../queue/types.js";
import { judgeModel, JUDGE_MODEL_ID } from "./gemini.js";
import { GeminiVerdictSchema, geminiResponseSchema } from "./schema.js";
import { SYSTEM_PROMPT, buildUserMessage } from "./prompt.js";
import type { ToolAction } from "./prompt.js";

export async function invokeJudge(
  session_id: string,
  batch: DetectionQueuePayload[],
): Promise<void> {
  // 1. Fetch previous rolling session summary
  const lastVerdict = await db
    .select({ session_summary: verdicts.session_summary })
    .from(verdicts)
    .where(eq(verdicts.session_id, session_id))
    .orderBy(desc(verdicts.created_at))
    .limit(1);

  const previous_summary = lastVerdict[0]?.session_summary ?? null;

  // 2. Fetch tool names from Redis
  const rawActions = await redis.lrange(`actions:${session_id}`, 0, -1);
  const tool_actions: ToolAction[] = rawActions.map((r) => {
    try {
      return JSON.parse(r) as ToolAction;
    } catch {
      return { tool_name: r, hop: 0, created_at: 0 };
    }
  });

  // 3. Build prompt
  const userMessage = buildUserMessage({
    session_id,
    batch,
    previous_summary,
    tool_actions,
  });

  // 4. Call Gemini — throws on network/rate-limit error (BullMQ retries)
  const response = await judgeModel.generateContent({
    model: JUDGE_MODEL_ID,
    contents: [{ role: "user", parts: [{ text: userMessage }] }],
    config: {
      systemInstruction: SYSTEM_PROMPT,
      responseMimeType: "application/json",
      responseSchema: geminiResponseSchema,
    },
  });

  // 5. Parse and validate — throws on malformed response (BullMQ retries)
  const responseText = response.text; // getter, not a method
  if (!responseText) throw new Error("Gemini returned empty response");
  const raw: unknown = JSON.parse(responseText);
  const geminiVerdict = GeminiVerdictSchema.parse(raw);

  // 6. Compute defender_judge_disagree deterministically
  const any_high_score = batch.some(
    (d) => (d.tier2_score ?? 0) >= TIER2_HIGH_THRESHOLD,
  );
  const defender_judge_disagree =
    (any_high_score && geminiVerdict.verdict === "benign") ||
    (!any_high_score && geminiVerdict.verdict === "injection");

  // 7. Write verdict to Postgres — throws on failure (BullMQ retries)
  const [inserted] = await db
    .insert(verdicts)
    .values({
      session_id,
      detection_ids: batch.map((d) => d.detection_id),
      verdict: geminiVerdict.verdict,
      confidence: geminiVerdict.confidence,
      attack_type: geminiVerdict.attack_type,
      novelty_flag: geminiVerdict.novelty_flag,
      reasoning: geminiVerdict.reasoning,
      behavioral_fingerprint: geminiVerdict.behavioral_fingerprint,
      session_summary: geminiVerdict.session_summary,
      defender_judge_disagree,
      fed_to_flywheel: false,
      human_reviewed: false,
    })
    .returning({ id: verdicts.id });

  const verdict_id = inserted?.id ?? "unknown";

  logger.info(
    {
      session_id,
      verdict: geminiVerdict.verdict,
      confidence: geminiVerdict.confidence,
      defender_judge_disagree,
      novelty_flag: geminiVerdict.novelty_flag,
      hop_count: batch.length,
    },
    "verdict written",
  );

  // 8. Fire-and-forget post-write actions
  if (geminiVerdict.verdict === "injection" || geminiVerdict.novelty_flag) {
    void import("../alerting/judge-alert.js")
      .then(({ triggerJudgeAlert }) => {
        const firstDetection = batch[0];
        triggerJudgeAlert({
          session_id,
          verdict: geminiVerdict.verdict,
          novelty_flag: geminiVerdict.novelty_flag,
          confidence: geminiVerdict.confidence,
          attack_type: geminiVerdict.attack_type,
          reasoning: geminiVerdict.reasoning,
          agent_id: firstDetection?.agent_id ?? "unknown",
          source_url: firstDetection?.source_url,
          hop: firstDetection?.hop ?? 0,
          tier2_score: firstDetection?.tier2_score ?? null,
          max_sentence: firstDetection?.max_sentence ?? null,
          tool_names: tool_actions.map((a) => a.tool_name),
          verdict_id,
        });
      })
      .catch((err: unknown) =>
        logger.error({ err }, "judge alert import failed"),
      );
  }
}
