import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { logger } from "../lib/logger.js";

const ARCHIVE_DIR =
  process.env.CONTENT_ARCHIVE_DIR ?? "./data/archive";

export interface ArchivePayload {
  detection_id: string;
  session_id: string;
  hop: number;
  source_url: string | undefined;
  raw_content: unknown;
}

// Called once at service startup to ensure the archive directory exists.
export async function initArchive(): Promise<void> {
  await mkdir(ARCHIVE_DIR, { recursive: true });
}

// Writes raw (pre-sanitization) content to {ARCHIVE_DIR}/{detection_id}.json.
// Fire-and-forget: errors are logged, never rethrown.
// Interface is intentionally minimal — swapping to S3 means replacing this
// function only.
export async function archiveContent(
  detectionId: string,
  payload: ArchivePayload,
): Promise<void> {
  try {
    const path = join(ARCHIVE_DIR, `${detectionId}.json`);
    await writeFile(
      path,
      JSON.stringify({ ...payload, archived_at: new Date().toISOString() }),
      "utf8",
    );
  } catch (err) {
    logger.error({ err, detectionId }, "archive write failed");
  }
}
