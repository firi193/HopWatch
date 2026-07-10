export interface DetectionQueuePayload {
  detection_id: string;
  session_id: string;
  hop: number;
  agent_id: string;
  source_url: string | undefined;
  tier2_score: number | null;
  max_sentence: string | null;
  detections: string[];
  allowed: boolean;
  is_novel_source: boolean;
  has_upstream_flags: boolean;
  is_instruction_like: boolean;
}
