import { z } from "zod";
import { defense } from "./defender.js";
import { hashContent } from "./hash.js";
import { archiveContent } from "./archive.js";
import { db } from "../db/index.js";
import { detections } from "../db/schema.js";
import { redis } from "../lib/redis.js";
import { logger } from "../lib/logger.js";
import { TIER2_MEDIUM_THRESHOLD, TIER2_HIGH_THRESHOLD } from "../queue/constants.js";
import type { DetectionQueuePayload } from "../queue/types.js";

// ---------------------------------------------------------------------------
// Shared request / response types (used by route handler and decorator)
// ---------------------------------------------------------------------------

export const AnalyzeRequestSchema = z.object({
  content: z.unknown(),
  agent_id: z.string().min(1),
  session_id: z.string().uuid(),
  hop: z.number().int().min(0),
  source_url: z.string().url().optional(),
  source_type: z.string().optional(),
});

export type AnalyzeRequest = z.infer<typeof AnalyzeRequestSchema>;

export interface AnalyzeResponse {
  sanitized: unknown;
  tier2_score: number | null;
  max_sentence: string | null;
  allowed: boolean;
  sentences_removed: boolean;
  detection_id: string;
}

// ---------------------------------------------------------------------------
// Secondary signal helpers
// ---------------------------------------------------------------------------

const SESSION_FLAGS_TTL = 86400; // 24 hours
const INSTRUCTION_VERBS = new Set([
  "ignore", "disregard", "forget", "override", "bypass",
  "skip", "dismiss", "stop", "drop", "delete", "remove",
  "pretend", "act", "behave", "reveal", "output", "print", "say",
]);

function isInstructionLike(sentence: string | null | undefined): boolean {
  if (!sentence) return false;
  const first = sentence.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  return INSTRUCTION_VERBS.has(first);
}

async function checkUpstreamFlags(sessionId: string): Promise<boolean> {
  const flags = await redis.hgetall(`session:flags:${sessionId}`);
  return Object.keys(flags ?? {}).length > 0;
}

async function checkNovelSource(
  sessionId: string,
  sourceUrl: string | undefined,
): Promise<boolean> {
  if (!sourceUrl) return false;
  const key = `session:sources:${sessionId}`;
  const seen = await redis.sismember(key, sourceUrl);
  if (!seen) {
    await redis.sadd(key, sourceUrl);
    await redis.expire(key, SESSION_FLAGS_TTL);
  }
  return seen === 0; // 0 means it was NOT a member — novel
}

async function recordSessionFlag(
  sessionId: string,
  hop: number,
  tier2Score: number,
): Promise<void> {
  const key = `session:flags:${sessionId}`;
  await redis.hset(key, { [hop]: tier2Score });
  await redis.expire(key, SESSION_FLAGS_TTL);
}

// ---------------------------------------------------------------------------
// Core pipeline — called by both the HTTP route and the decorator
// ---------------------------------------------------------------------------

export async function runAnalyze(req: AnalyzeRequest): Promise<AnalyzeResponse> {
  // 1. Hash received content
  const content_hash_received = hashContent(req.content);

  // 2. Run Defender
  const result = await defense.defendToolResult(
    req.content,
    req.source_type ?? "unknown",
  );

  const tier2_score = result.tier2Score ?? null;
  const max_sentence = result.maxSentence ?? null;

  // 3. Hash sanitized content (null if unchanged)
  const sanitizedDiffers =
    JSON.stringify(result.sanitized) !== JSON.stringify(req.content);
  const content_hash_sanitized = sanitizedDiffers
    ? hashContent(result.sanitized)
    : null;

  // 4. Generate detection_id
  const detection_id = crypto.randomUUID();

  // 5. Compute secondary signals (Redis lookups — awaited, before fire-and-forget)
  const [has_upstream_flags, is_novel_source] = await Promise.all([
    checkUpstreamFlags(req.session_id),
    checkNovelSource(req.session_id, req.source_url),
  ]);
  const is_instruction_like = isInstructionLike(max_sentence);

  // Record this hop's flag if score is above medium threshold
  if (tier2_score !== null && tier2_score > TIER2_MEDIUM_THRESHOLD) {
    void recordSessionFlag(req.session_id, req.hop, tier2_score).catch((err) =>
      logger.error({ err }, "session flag write failed"),
    );
  }

  // 6. Build queue payload
  const queuePayload: DetectionQueuePayload = {
    detection_id,
    session_id: req.session_id,
    hop: req.hop,
    agent_id: req.agent_id,
    source_url: req.source_url,
    tier2_score,
    max_sentence,
    detections: result.detections,
    allowed: result.allowed,
    is_novel_source,
    has_upstream_flags,
    is_instruction_like,
  };

  // 7–9. Fire-and-forget side effects
  void archiveContent(detection_id, {
    detection_id,
    session_id: req.session_id,
    hop: req.hop,
    source_url: req.source_url,
    raw_content: req.content,
  }).catch((err) => logger.error({ err }, "archive write failed"));

  void db
    .insert(detections)
    .values({
      id: detection_id,
      session_id: req.session_id,
      hop: req.hop,
      agent_id: req.agent_id,
      source_url: req.source_url,
      source_type: req.source_type,
      tier2_score,
      allowed: result.allowed,
      risk_level: result.riskLevel,
      detections: result.detections,
      fields_sanitized: result.fieldsSanitized,
      max_sentence,
      content_hash_received,
      content_hash_sanitized,
    })
    .catch((err) => logger.error({ err, detection_id }, "detections insert failed"));

  // Sync alert fires here when tier2_score > HIGH_THRESHOLD (Spec 06).
  // Import is deferred to avoid circular dependency — alerting imports from this module.
  if (tier2_score !== null && tier2_score > TIER2_HIGH_THRESHOLD) {
    void import("../alerting/defender-alert.js").then(({ triggerDefenderAlert }) => {
      const toolNamesRaw = redis.lrange(`actions:${req.session_id}`, 0, -1);
      void toolNamesRaw.then((raw: string[]) => {
        const toolNames = raw.map((r: string) => {
          try {
            return (JSON.parse(r) as { tool_name: string }).tool_name;
          } catch {
            return r;
          }
        });
        triggerDefenderAlert({
          agent_id: req.agent_id,
          source_url: req.source_url,
          hop: req.hop,
          tier2_score: tier2_score as number,
          max_sentence,
          tool_names: toolNames,
          detection_id,
          session_id: req.session_id,
        });
      });
    });
  }

  // Enqueue to routing queue (Spec 04) — imported lazily to avoid circular dep
  void import("../queue/router.js").then(({ enqueueDetection }) => {
    void enqueueDetection(queuePayload).catch((err: unknown) =>
      logger.error({ err, detection_id }, "queue enqueue failed"),
    );
  });

  return {
    sanitized: result.sanitized,
    tier2_score,
    max_sentence,
    allowed: result.allowed,
    sentences_removed: sanitizedDiffers,
    detection_id,
  };
}

// ---------------------------------------------------------------------------
// @analyzeExternal decorator
// ---------------------------------------------------------------------------

interface AnalyzeExternalOptions {
  sessionId: string;
  hop: number;
  agentId: string;
  sourceUrl?: string;
  sourceType?: string;
}

export function analyzeExternal(options: AnalyzeExternalOptions) {
  return function (
    _target: object,
    _propertyKey: string | symbol,
    descriptor: PropertyDescriptor,
  ): PropertyDescriptor {
    const original = descriptor.value as (...args: unknown[]) => Promise<unknown>;

    descriptor.value = async function (...args: unknown[]) {
      const rawContent = await original.apply(this, args);

      const result = await runAnalyze({
        content: rawContent,
        agent_id: options.agentId,
        session_id: options.sessionId,
        hop: options.hop,
        source_url: options.sourceUrl,
        source_type: options.sourceType,
      });

      // Attach detection_id to object results for correlation; pass through primitives as-is
      if (
        result.sanitized !== null &&
        typeof result.sanitized === "object" &&
        !Array.isArray(result.sanitized)
      ) {
        return { ...(result.sanitized as object), _detection_id: result.detection_id };
      }

      return result.sanitized;
    };

    return descriptor;
  };
}
