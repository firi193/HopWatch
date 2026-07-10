import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { QUEUE_HIGH, QUEUE_MEDIUM } from "./constants.js";

// Dedicated BullMQ Redis connection — separate from src/lib/redis.ts.
// BullMQ requires maxRetriesPerRequest: null.
export const bullRedis = new Redis(
  process.env.REDIS_URL ?? "redis://localhost:6379",
  { maxRetriesPerRequest: null },
);

export const highQueue = new Queue(QUEUE_HIGH, { connection: bullRedis });
export const mediumQueue = new Queue(QUEUE_MEDIUM, { connection: bullRedis });
