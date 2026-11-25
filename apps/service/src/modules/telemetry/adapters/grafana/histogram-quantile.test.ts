import { describe, expect, it } from "vitest";
import { boundOf, histogramQuantile, type Bucket } from "./histogram-quantile.js";

const INF = Number.POSITIVE_INFINITY;

function buckets(...pairs: [number, number][]): Bucket[] {
  return pairs.map(([le, count]) => ({ le, count }));
}

describe("histogramQuantile, as PromQL's histogram_quantile of classic buckets", () => {
  it("interpolates within the bucket the rank falls in, from 0 in the first", () => {
    const ten = buckets([0.1, 4], [0.5, 8], [1, 10], [INF, 10]);
    // Rank 9.5 of 10 falls in (0.5, 1], whose 2 observations hold ranks 8 to 10.
    expect(histogramQuantile(0.95, ten)).toBeCloseTo(0.875, 10);
    // Rank 2 of 10 falls in the first bucket, (0, 0.1].
    expect(histogramQuantile(0.2, ten)).toBeCloseTo(0.05, 10);
  });

  it("answers 1 as the upper bound of the highest bucket that holds an observation", () => {
    expect(histogramQuantile(1, buckets([0.1, 4], [0.5, 8], [1, 8], [2.5, 8], [INF, 8]))).toBe(0.5);
  });

  it("answers the highest finite bound when the rank falls in +Inf", () => {
    expect(histogramQuantile(1, buckets([0.1, 4], [0.5, 8], [INF, 9]))).toBe(0.5);
  });

  it("adds up buckets of one bound, from every row or step, in any order", () => {
    const rows = [
      ...buckets([INF, 10], [1, 10], [0.5, 8], [0.1, 4]),
      ...buckets([0.1, 6], [0.5, 12], [1, 20], [INF, 20]),
    ];
    // Together: 10 ≤ 0.1, 20 ≤ 0.5, 30 ≤ 1; rank 28.5 in (0.5, 1].
    expect(histogramQuantile(0.95, rows)).toBeCloseTo(0.5 + 0.5 * (8.5 / 10), 10);
  });

  it("makes uneven counts monotonic, as increase over each bucket can leave them", () => {
    expect(histogramQuantile(0.5, buckets([0.1, 5], [0.5, 4.9], [INF, 10]))).toBe(0.1);
  });

  it("answers nothing with no observation, no +Inf bucket or a single bucket", () => {
    expect(histogramQuantile(0.95, buckets([0.1, 0], [INF, 0]))).toBeUndefined();
    expect(histogramQuantile(0.95, buckets([0.1, 3], [0.5, 4]))).toBeUndefined();
    expect(histogramQuantile(0.95, buckets([INF, 4]))).toBeUndefined();
    expect(histogramQuantile(0.95, [])).toBeUndefined();
  });

  it("reads a bucket's bound from its le label", () => {
    expect(boundOf("+Inf")).toBe(INF);
    expect(boundOf("0.025")).toBe(0.025);
    expect(boundOf("")).toBeUndefined();
    expect(boundOf("x")).toBeUndefined();
  });
});
