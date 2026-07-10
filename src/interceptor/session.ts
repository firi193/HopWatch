// Session ID: UUIDv4, generated once on first @analyze_external call in a chain.
// Hop: integer, starts at 0, incremented at each agent boundary.
//
// For MVP, session_id + hop are passed explicitly by the agent — no automatic
// propagation. The agent author threads them through the call chain manually.

export function generateSessionId(): string {
  return crypto.randomUUID();
}
