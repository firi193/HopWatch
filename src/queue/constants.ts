export const TIER2_HIGH_THRESHOLD = Number(process.env.TIER2_HIGH_THRESHOLD ?? "0.7");
export const TIER2_MEDIUM_THRESHOLD = Number(process.env.TIER2_MEDIUM_THRESHOLD ?? "0.3");

export const HIGH_QUEUE_BATCH_SIZE = 10;
export const MEDIUM_QUEUE_CRON = "*/15 * * * *";

export const QUEUE_HIGH = "judge-high";
export const QUEUE_MEDIUM = "judge-medium";
