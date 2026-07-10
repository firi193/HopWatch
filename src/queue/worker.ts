import { Worker } from "bullmq";
import { bullRedis, highQueue, mediumQueue } from "./client.js";
import {
  HIGH_QUEUE_BATCH_SIZE,
  MEDIUM_QUEUE_CRON,
  QUEUE_HIGH,
  QUEUE_MEDIUM,
} from "./constants.js";
import type { DetectionQueuePayload } from "./types.js";
import { invokeJudge } from "../judge/index.js";
import { logger } from "../lib/logger.js";

// ---------------------------------------------------------------------------
// In-memory accumulators (keyed by session_id within each lane)
// ---------------------------------------------------------------------------
// Jobs are marked complete immediately after being added to the buffer.
// The buffer is flushed to the Judge LLM when the trigger condition is met.
// Accepted trade-off for MVP: a process crash between job completion and
// buffer flush means those detections skip the Judge for that window.
// They remain in Postgres (detections table) and can be replayed manually.

const highBuffer = new Map<string, DetectionQueuePayload[]>();
const mediumBuffer = new Map<string, DetectionQueuePayload[]>();

function addToBuffer(
  buffer: Map<string, DetectionQueuePayload[]>,
  payload: DetectionQueuePayload,
): void {
  const existing = buffer.get(payload.session_id) ?? [];
  existing.push(payload);
  buffer.set(payload.session_id, existing);
}

function bufferTotal(buffer: Map<string, DetectionQueuePayload[]>): number {
  let total = 0;
  for (const arr of buffer.values()) total += arr.length;
  return total;
}

async function flushBuffer(
  buffer: Map<string, DetectionQueuePayload[]>,
  lane: string,
): Promise<void> {
  if (buffer.size === 0) return;

  const sessions = [...buffer.entries()];
  buffer.clear();

  for (const [session_id, payloads] of sessions) {
    await invokeJudge(session_id, payloads).catch((err: unknown) =>
      logger.error({ err, session_id, lane }, "invokeJudge failed"),
    );
  }
}

// ---------------------------------------------------------------------------
// High queue — flush when total buffer reaches HIGH_QUEUE_BATCH_SIZE
// or after a 5-minute stale guard
// ---------------------------------------------------------------------------

const HIGH_STALE_MS = 5 * 60 * 1000;
let highStaleTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleHighStaleFlush(): void {
  if (highStaleTimer) return;
  highStaleTimer = setTimeout(() => {
    highStaleTimer = null;
    void flushBuffer(highBuffer, "high").catch((err: unknown) =>
      logger.error({ err }, "high stale flush failed"),
    );
  }, HIGH_STALE_MS);
}

function cancelHighStaleFlush(): void {
  if (highStaleTimer) {
    clearTimeout(highStaleTimer);
    highStaleTimer = null;
  }
}

const _highWorker = new Worker<DetectionQueuePayload>(
  QUEUE_HIGH,
  async (job) => {
    addToBuffer(highBuffer, job.data);

    if (bufferTotal(highBuffer) >= HIGH_QUEUE_BATCH_SIZE) {
      cancelHighStaleFlush();
      await flushBuffer(highBuffer, "high");
    } else {
      scheduleHighStaleFlush();
    }
  },
  { connection: bullRedis, concurrency: 1 },
);

// ---------------------------------------------------------------------------
// Medium queue — workers add to buffer; setInterval flushes every 15 minutes
// ---------------------------------------------------------------------------

const _mediumWorker = new Worker<DetectionQueuePayload>(
  QUEUE_MEDIUM,
  async (job) => {
    addToBuffer(mediumBuffer, job.data);
    // Flush is handled by the cron interval below
  },
  { connection: bullRedis, concurrency: 1 },
);

// Parse MEDIUM_QUEUE_CRON ("*/15 * * * *") → milliseconds between flushes.
// For MVP, setInterval is sufficient — no need for a full cron parser.
function cronToMs(cron: string): number {
  const minutesMatch = /^\*\/(\d+)/.exec(cron);
  const minutes = minutesMatch ? parseInt(minutesMatch[1]!, 10) : 15;
  return minutes * 60 * 1000;
}

setInterval(() => {
  void flushBuffer(mediumBuffer, "medium").catch((err: unknown) =>
    logger.error({ err }, "medium cron flush failed"),
  );
}, cronToMs(MEDIUM_QUEUE_CRON));

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

async function shutdown(): Promise<void> {
  logger.info("worker shutting down...");
  cancelHighStaleFlush();

  // Flush any remaining buffered data before exit
  await Promise.allSettled([
    flushBuffer(highBuffer, "high"),
    flushBuffer(mediumBuffer, "medium"),
  ]);

  await Promise.allSettled([
    highQueue.close(),
    mediumQueue.close(),
    bullRedis.quit(),
  ]);

  logger.info("worker stopped");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());

logger.info("queue worker started");
