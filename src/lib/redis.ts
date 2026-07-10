import { Redis } from "ioredis";
import { logger } from "./logger.js";

// General-purpose Redis client for session flags and action lists.
// Separate from the BullMQ connection in src/queue/client.ts.
export const redis = new Redis(
  process.env.REDIS_URL ?? "redis://localhost:6379",
  { lazyConnect: true, maxRetriesPerRequest: 3 },
);

redis.on("error", (err: unknown) => logger.error({ err }, "redis connection error"));
