import { createPromptDefense } from "@stackone/defender";
import { logger } from "../lib/logger.js";

// DISABLE_TIER2=true skips the ONNX model (requires onnxruntime-node, ~100MB).
// Use in development when onnxruntime-node is not installed.
// Tier 1 pattern matching still runs; tier2_score will be null on all results.
const tier2Enabled = process.env.DISABLE_TIER2 !== "true";

export const defense = createPromptDefense({
  blockHighRisk: false,
  enableTier2: tier2Enabled,
});

export async function initDefender(): Promise<void> {
  if (!tier2Enabled) {
    logger.warn("Tier 2 disabled (DISABLE_TIER2=true) — only Tier 1 pattern matching active");
    return;
  }
  logger.info("warming up Defender Tier 2 model...");
  await defense.warmupTier2();
  logger.info("Defender ready");
}
