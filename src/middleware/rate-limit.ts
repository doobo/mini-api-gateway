/**
 * In-memory sliding-window rate limiter (spec section 16).
 * Single-process only by design; window is 60 seconds, limit is RPM.
 */
interface RateBucket {
  timestamps: number[];
}

const WINDOW_MS = 60_000;

export class RateLimiter {
  private buckets = new Map<string, RateBucket>();
  private lastCleanup = Date.now();

  check(key: string, limitPerMinute: number): void {
    const now = Date.now();
    this.maybeCleanup(now);

    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { timestamps: [] };
      this.buckets.set(key, bucket);
    }

    // Drop timestamps outside the sliding window.
    bucket.timestamps = bucket.timestamps.filter((t) => now - t < WINDOW_MS);
    if (bucket.timestamps.length >= limitPerMinute) {
      const oldest = bucket.timestamps[0];
      const retryAfter = oldest ? Math.ceil((WINDOW_MS - (now - oldest)) / 1000) : 60;
      const error = new RateLimitError(retryAfter);
      throw error;
    }
    bucket.timestamps.push(now);
  }

  /**
   * Drop a bucket entirely. Used where a bucket tracks *failures*: a
   * successful login clears the client's failure count.
   */
  reset(key: string): void {
    this.buckets.delete(key);
  }

  private maybeCleanup(now: number): void {
    if (now - this.lastCleanup < WINDOW_MS) return;
    this.lastCleanup = now;
    for (const [key, bucket] of this.buckets) {
      if (
        bucket.timestamps.length === 0 ||
        now - bucket.timestamps[bucket.timestamps.length - 1]! > WINDOW_MS * 2
      ) {
        this.buckets.delete(key);
      }
    }
  }
}

export class RateLimitError extends Error {
  readonly retryAfterSeconds: number;
  constructor(retryAfterSeconds: number) {
    super("Rate limit exceeded");
    this.name = "RateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export const rateLimiter = new RateLimiter();
