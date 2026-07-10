import { sendSlackAlert } from "./slack.js";

export interface JudgeAlertPayload {
  session_id: string;
  verdict: "injection" | "benign" | "uncertain";
  novelty_flag: boolean;
  confidence: number;
  attack_type: string | null;
  reasoning: string;
  agent_id: string;
  source_url: string | undefined;
  hop: number;
  tier2_score: number | null;
  max_sentence: string | null;
  tool_names: string[];
  verdict_id: string;
}

// Fire-and-forget — called after verdict Postgres write in invokeJudge.
export function triggerJudgeAlert(payload: JudgeAlertPayload): void {
  const is_injection = payload.verdict === "injection";
  const severity = is_injection ? "critical" : "medium";

  void sendSlackAlert({
    severity,
    title: is_injection
      ? "Judge: Injection verdict"
      : "Judge: Novel pattern detected",
    fields: {
      Verdict: payload.verdict,
      Confidence: payload.confidence.toFixed(2),
      "Attack type": payload.attack_type ?? "—",
      Novelty: payload.novelty_flag ? "yes" : "no",
      Agent: payload.agent_id,
      Session: payload.session_id,
      Hop: String(payload.hop),
      Score: payload.tier2_score?.toFixed(3) ?? "—",
      "Max sentence": payload.max_sentence ?? "—",
      "Tool calls": payload.tool_names.join(", ") || "none",
      Reasoning: `${payload.reasoning.slice(0, 200)}...`,
    },
    session_link: `postgres://verdicts?id=${payload.verdict_id}`,
  });
}
