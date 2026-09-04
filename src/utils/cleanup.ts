import type { AppConfig } from "../config/config";
import { purgeOldLogs } from "../db/queries";
import { logger } from "./logger";

const CHECK_INTERVAL_MS = 60_000; // check every minute whether it's cleanup time

let timer: ReturnType<typeof setInterval> | null = null;
let lastRunDay = -1;

/**
 * Daily log cleanup: deletes usage_logs and audit_logs older than
 * config.logRetentionDays at config.logCleanupTime local time.
 * `lastRunDay` makes the check idempotent across restarts within the same day
 * (if the server is down at the scheduled time it simply runs at next check).
 */
export function startLogCleanup(config: AppConfig): void {
  if (config.logRetentionDays <= 0) {
    logger.info("log cleanup disabled (LOG_RETENTION_DAYS=0)");
    return;
  }
  lastRunDay = -1;
  timer = setInterval(() => {
    const now = new Date();
    const [h, m] = config.logCleanupTime.split(":").map(Number) as [number, number];
    const minutesNow = now.getHours() * 60 + now.getMinutes();
    const target = h! * 60 + m!;
    const day = now.getFullYear() * 10_000 + now.getMonth() * 100 + now.getDate();
    if (minutesNow >= target && lastRunDay !== day) {
      lastRunDay = day;
      const deleted = purgeOldLogs(config.logRetentionDays);
      logger.info(
        `daily log cleanup: removed ${deleted.usage} usage logs, ${deleted.audit} audit logs (retention ${config.logRetentionDays}d)`,
      );
    }
  }, CHECK_INTERVAL_MS);
  // Don't keep the process alive just for the cleanup timer.
  timer.unref?.();
}

export function stopLogCleanup(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

/** Manual trigger used by POST /admin/logs/cleanup. */
export function runCleanupNow(config: AppConfig): { usage: number; audit: number } {
  return purgeOldLogs(config.logRetentionDays);
}
