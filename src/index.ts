import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { initDefender } from "./interceptor/defender.js";
import { initArchive } from "./interceptor/archive.js";
import { analyzeRouter } from "./routes/analyze.js";
import { actionRouter } from "./routes/action.js";
import { logger } from "./lib/logger.js";

const app = new Hono();

app.route("/", analyzeRouter);
app.route("/", actionRouter);

app.get("/health", (c) => c.json({ status: "ok" }));

async function start(): Promise<void> {
  await initArchive();
  await initDefender();

  const port = Number(process.env.PORT ?? 3000);
  serve({ fetch: app.fetch, port });
  logger.info({ port }, "server listening");
}

start().catch((err: unknown) => {
  logger.error({ err }, "failed to start server");
  process.exit(1);
});
