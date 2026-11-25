/** A histogram bucket: its upper bound (`le`) and the observations at or under it. */
export interface Bucket {
  readonly le: number;
  readonly count: number;
}

/** A bucket's bound as Prometheus labels it, `+Inf` for the last; undefined for none. */
export function boundOf(le: string): number | undefined {
  if (le === "+Inf") return Number.POSITIVE_INFINITY;
  const bound = Number(le);
  return le === "" || Number.isNaN(bound) ? undefined : bound;
}

/**
 * The φ-quantile of cumulative buckets, as PromQL's `histogram_quantile` takes it of classic
 * buckets: the bucket the rank falls in, interpolated linearly within it (from 0 for the first
 * bucket); the highest finite bound when the rank falls in `+Inf`. So φ = 1 is the upper bound of
 * the highest bucket that holds an observation, an "at most" figure. Buckets of one bound are added
 * up and their counts made monotonic first, as `increase` over each can come out uneven. Undefined
 * without a `+Inf` bucket, with fewer than two buckets or with no observation.
 */
export function histogramQuantile(phi: number, buckets: readonly Bucket[]): number | undefined {
  const byBound = new Map<number, number>();
  for (const { le, count } of buckets) byBound.set(le, (byBound.get(le) ?? 0) + count);
  const sorted = [...byBound].toSorted(([a], [b]) => a - b);
  if (sorted.length < 2 || sorted.at(-1)?.[0] !== Number.POSITIVE_INFINITY) return undefined;
  let highest = 0;
  const cumulative = sorted.map(([le, count]) => {
    highest = Math.max(highest, count);
    return { le, count: highest };
  });
  const observations = cumulative.at(-1)!.count;
  if (observations <= 0) return undefined;
  const rank = phi * observations;
  const last = cumulative.length - 1;
  let index = cumulative.findIndex((bucket, at) => at < last && bucket.count >= rank);
  if (index < 0) index = last;
  if (index === last) return cumulative[last - 1]!.le;
  const bucket = cumulative[index]!;
  if (index === 0 && bucket.le <= 0) return bucket.le;
  const below = index > 0 ? cumulative[index - 1]! : { le: 0, count: 0 };
  return below.le + (bucket.le - below.le) * ((rank - below.count) / (bucket.count - below.count));
}
