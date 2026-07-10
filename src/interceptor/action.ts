import { z } from "zod";
import { db } from "../db/index.js";
import { agent_actions } from "../db/schema.js";
import { redis } from "../lib/redis.js";
import { logger } from "../lib/logger.js";

// ---------------------------------------------------------------------------
// Shared request type (used by route handler and decorator)
// ---------------------------------------------------------------------------

export const ActionRequestSchema = z.object({
  tool_name: z.string().min(1),
  agent_id: z.string().min(1),
  session_id: z.string().uuid(),
  hop: z.number().int().min(0),
});

export type ActionRequest = z.infer<typeof ActionRequestSchema>;

const ACTIONS_TTL = 86400; // 24 hours

// ---------------------------------------------------------------------------
// Core pipeline — called by both the HTTP route and the decorator
// ---------------------------------------------------------------------------

export async function runRecordAction(req: ActionRequest): Promise<void> {
  const entry = JSON.stringify({
    tool_name: req.tool_name,
    hop: req.hop,
    created_at: Date.now(),
  });

  // Both writes run concurrently; failures are logged but never rethrown.
  const results = await Promise.allSettled([
    db.insert(agent_actions).values({
      session_id: req.session_id,
      hop: req.hop,
      agent_id: req.agent_id,
      tool_name: req.tool_name,
    }),
    redis
      .rpush(`actions:${req.session_id}`, entry)
      .then(() => redis.expire(`actions:${req.session_id}`, ACTIONS_TTL)),
  ]);

  for (const result of results) {
    if (result.status === "rejected") {
      logger.error({ err: result.reason, session_id: req.session_id }, "action record write failed");
    }
  }
}

// ---------------------------------------------------------------------------
// @recordAction decorator
// ---------------------------------------------------------------------------

interface RecordActionOptions {
  sessionId: string;
  hop: number;
  agentId: string;
}

export function recordAction(options: RecordActionOptions) {
  return function (
    _target: object,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor,
  ): PropertyDescriptor {
    const original = descriptor.value as (...args: unknown[]) => Promise<unknown>;
    const tool_name = String(propertyKey);

    descriptor.value = async function (...args: unknown[]) {
      // Pre-execution capture: record the intent before the call succeeds or fails.
      await runRecordAction({
        tool_name,
        agent_id: options.agentId,
        session_id: options.sessionId,
        hop: options.hop,
      }).catch((err: unknown) =>
        logger.error({ err, tool_name }, "recordAction write failed — tool call proceeding"),
      );

      return original.apply(this, args);
    };

    return descriptor;
  };
}
