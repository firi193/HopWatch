import { Hono } from "hono";
import { ActionRequestSchema, runRecordAction } from "../interceptor/action.js";
import { logger } from "../lib/logger.js";

export const actionRouter = new Hono();

// POST /action — always returns 200. Storage errors are logged, never surfaced.
actionRouter.post("/action", async (c) => {
  const body = await c.req.json().catch(() => null);

  const parsed = ActionRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.message }, 400);
  }

  await runRecordAction(parsed.data).catch((err: unknown) =>
    logger.error({ err }, "POST /action pipeline failed"),
  );

  return c.body(null, 200);
});
