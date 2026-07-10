import { Hono } from "hono";
import { AnalyzeRequestSchema, runAnalyze } from "../interceptor/analyze.js";
import { logger } from "../lib/logger.js";

export const analyzeRouter = new Hono();

analyzeRouter.post("/analyze", async (c) => {
  const body = await c.req.json().catch(() => null);

  const parsed = AnalyzeRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.message }, 400);
  }

  try {
    const result = await runAnalyze(parsed.data);
    return c.json(result, 200);
  } catch (err) {
    logger.error({ err }, "POST /analyze failed");
    return c.json({ error: "internal error" }, 500);
  }
});
