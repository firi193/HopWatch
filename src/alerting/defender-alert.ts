import { sendSlackAlert } from "./slack.js";

export interface DefenderAlertPayload {
  agent_id: string;
  source_url: string | undefined;
  hop: number;
  tier2_score: number;
  max_sentence: string | null;
  tool_names: string[];
  detection_id: string;
  session_id: string;
}

// Fire-and-forget — called from POST /analyze hot path, never awaited.
export function triggerDefenderAlert(payload: DefenderAlertPayload): void {
  void sendSlackAlert({
    severity: "high",
    title: "Defender: High-risk content detected",
    fields: {
      Agent: payload.agent_id,
      Session: payload.session_id,
      Hop: String(payload.hop),
      Source: payload.source_url ?? "unknown",
      Score: payload.tier2_score.toFixed(3),
      "Max sentence": payload.max_sentence ?? "—",
      "Tool calls": payload.tool_names.join(", ") || "none",
    },
    session_link: `postgres://detections?session_id=${payload.session_id}`,
  });
}
