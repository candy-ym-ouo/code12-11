import pino from "pino";
import { env } from "../config/env";

export const logger = pino({
  level: env.isTest ? "silent" : env.LOG_LEVEL,
  base: { service: "nature-timeline-api", env: env.NODE_ENV },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: ["req.headers.authorization", "req.headers.cookie", "*.password", "*.passwordHash", "*.token"],
    remove: true,
  },
});

/** 邮箱脱敏：只保留前 3 位与域名。 */
export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  const head = local.slice(0, 3);
  return `${head}***@${domain}`;
}
