/** The smallest duration told apart from zero; shorter ones share the first bucket. */
const SMALLEST_MS = 0.01;

/** Each bucket's upper bound is this times the one before: a percentile is at most ~9% high. */
const BUCKET_RATIO = 2 ** (1 / 8);
const LOG_RATIO = Math.log(BUCKET_RATIO);

/** Ten minutes and more share the last bucket. */
const LAST_BUCKET = Math.ceil(Math.log(600_000 / SMALLEST_MS) / LOG_RATIO);

function bucketOf(ms: number): number {
  if (!(ms > SMALLEST_MS)) return 0;
  return Math.min(LAST_BUCKET, Math.ceil(Math.log(ms / SMALLEST_MS) / LOG_RATIO));
}

function upperBoundOf(bucket: number): number {
  return SMALLEST_MS * BUCKET_RATIO ** bucket;
}

/**
 * Durations kept by log-scale bucket, so a percentile is approximate but costs no more than the
 * buckets in use, however many durations went in; histograms merge, so an hour's p95 is the merge
 * of its steps' or minutes'. Sparse: only the buckets in use are kept.
 */
export class DurationHistogram {
  private readonly counts = new Map<number, number>();
  private total = 0;
  private totalMs = 0;
  private maxMs = 0;

  add(ms: number): void {
    const bucket = bucketOf(ms);
    this.counts.set(bucket, (this.counts.get(bucket) ?? 0) + 1);
    this.total += 1;
    this.totalMs += ms;
    if (ms > this.maxMs) this.maxMs = ms;
  }

  merge(other: DurationHistogram): void {
    for (const [bucket, count] of other.counts) {
      this.counts.set(bucket, (this.counts.get(bucket) ?? 0) + count);
    }
    this.total += other.total;
    this.totalMs += other.totalMs;
    if (other.maxMs > this.maxMs) this.maxMs = other.maxMs;
  }

  get count(): number {
    return this.total;
  }

  get sumMs(): number {
    return this.totalMs;
  }

  get max(): number {
    return this.maxMs;
  }

  /**
   * The duration `percent` of the durations are at or below: its bucket's upper bound, never
   * above the longest seen; null when none went in.
   */
  percentile(percent: number): number | null {
    if (this.total === 0) return null;
    const rank = Math.max(1, Math.ceil((percent / 100) * this.total));
    let seen = 0;
    for (const bucket of [...this.counts.keys()].toSorted((a, b) => a - b)) {
      seen += this.counts.get(bucket) ?? 0;
      if (seen >= rank) return Math.min(upperBoundOf(bucket), this.maxMs);
    }
    return this.maxMs;
  }
}
