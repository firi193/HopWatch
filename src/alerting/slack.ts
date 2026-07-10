import { logger } from "../lib/logger.js";

export interface SlackAlert {
  severity: "critical" | "high" | "medium";
  title: string;
  fields: Record<string, string>;
  session_link: string;
}

const SEVERITY_EMOJI: Record<SlackAlert["severity"], string> = {
  critical: "🚨",
  high: "⚠️",
  medium: "🔍",
};

function buildSlackPayload(alert: SlackAlert): unknown {
  const emoji = SEVERITY_EMOJI[alert.severity];

  // Slack Block Kit section.fields supports up to 10 items
  const fieldBlocks = Object.entries(alert.fields).map(([label, value]) => ({
    type: "mrkdwn",
    text: `*${label}:*\n${value}`,
  }));

  return {
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `${emoji} ${alert.title}`,
          emoji: true,
        },
      },
      {
        type: "section",
        fields: fieldBlocks,
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `<${alert.session_link}|View session record>`,
        },
      },
    ],
  };
}

// Errors are caught and logged — never rethrown.
// A missing or failing webhook must never affect the main pipeline.
export async function sendSlackAlert(alert: SlackAlert): Promise<void> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    logger.warn("SLACK_WEBHOOK_URL not set — alert suppressed");
    return;
  }

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildSlackPayload(alert)),
    });

    if (!res.ok) {
      logger.warn(
        { status: res.status, severity: alert.severity },
        "Slack webhook returned non-OK status",
      );
    }
  } catch (err) {
    logger.error({ err, severity: alert.severity }, "Slack webhook request failed");
  }
}
