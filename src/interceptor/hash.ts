import { createHash } from "node:crypto";

// SHA-256 of UTF-8 content. Objects are JSON-serialized before hashing.
// Returns a lowercase hex string.
export function hashContent(content: unknown): string {
  const str =
    typeof content === "string" ? content : JSON.stringify(content);
  return createHash("sha256").update(str, "utf8").digest("hex");
}
