import { highQueue, mediumQueue } from "./client.js";
import {
  TIER2_HIGH_THRESHOLD,
  TIER2_MEDIUM_THRESHOLD,
} from "./constants.js";
import type { DetectionQueuePayload } from "./types.js";

export async function enqueueDetection(
  payload: DetectionQueuePayload,
): Promise<void> {
  const lane = determineLane(payload);
  const queue = lane === "high" ? highQueue : mediumQueue;
  await queue.add("evaluate", payload, {
    removeOnComplete: 100,
    removeOnFail: 50,
  });
}

function determineLane(p: DetectionQueuePayload): "high" | "medium" {
  const score = p.tier2_score ?? 0;

  if (score >= TIER2_HIGH_THRESHOLD) return "high";

  if (score < TIER2_MEDIUM_THRESHOLD) {
    if (p.is_novel_source || p.has_upstream_flags || p.is_instruction_like) {
      return "high";
    }
    return "medium";
  }

  // Mid-range (TIER2_MEDIUM_THRESHOLD ≤ score < TIER2_HIGH_THRESHOLD) → medium
  return "medium";
}
