import type { UsageWindow, UsageWindows } from "./usage-windows.js";

/*
 * What the account's windows move by per token (spec §5.4): learnt Office-wide from successive
 * readings of one Reading source, as `utilization` comes in whole percents and one run rarely
 * moves it (task 37's steps 7 and 7b).
 */

/** How many of the latest counted pairs on an engine id the ratios pool. */
export const POOLED_SAMPLES = 500;

/** A reading as pairing needs it: the windows, when they were read and the Office's counted tokens. */
export interface PairedReading extends UsageWindows {
  readonly readAt: Date;
  /** Input, output and cache writes of every turn on the engine id so far, as every token count. */
  readonly officeTokens: number;
}

/**
 * Two successive readings of one source that count: the Office's tokens between them and each
 * window's change in percentage points, undefined for a window that reset or went down.
 */
export interface UsageWindowSample {
  readonly readAt: Date;
  readonly tokens: number;
  readonly fiveHour: number | undefined;
  readonly sevenDay: number | undefined;
}

/** Window % per counted token; undefined for a window no counted pair gives. */
export interface UsageWindowRatios {
  readonly fiveHour: number | undefined;
  readonly sevenDay: number | undefined;
}

export const NO_USAGE_WINDOW_RATIOS: UsageWindowRatios = {
  fiveHour: undefined,
  sevenDay: undefined,
};

/**
 * The pair `earlier` → `later` when it counts: one known source, the Office's tokens went up, and a
 * window that neither reset nor went down. A change of 0 counts: most pairs are 0 at whole percents,
 * and leaving them out would raise the ratio.
 */
export function sampleBetween(
  earlier: PairedReading,
  later: PairedReading,
): UsageWindowSample | undefined {
  if (earlier.source === undefined || earlier.source !== later.source) return undefined;
  const tokens = later.officeTokens - earlier.officeTokens;
  if (tokens <= 0) return undefined;
  const fiveHour = changeOf(earlier.fiveHour, later.fiveHour, later.readAt);
  const sevenDay = changeOf(earlier.sevenDay, later.sevenDay, later.readAt);
  if (fiveHour === undefined && sevenDay === undefined) return undefined;
  return { readAt: later.readAt, tokens, fiveHour, sevenDay };
}

/** Each window's changes summed over the tokens of the samples that give it. */
export function pooledRatios(samples: readonly UsageWindowSample[]): UsageWindowRatios {
  return { fiveHour: ratioOf(samples, "fiveHour"), sevenDay: ratioOf(samples, "sevenDay") };
}

function changeOf(before: UsageWindow, after: UsageWindow, readAt: Date): number | undefined {
  if (before.resetsAt !== undefined && readAt >= before.resetsAt) return undefined;
  const change = after.percentUsed - before.percentUsed;
  return change < 0 ? undefined : change;
}

function ratioOf(
  samples: readonly UsageWindowSample[],
  window: keyof UsageWindowRatios,
): number | undefined {
  let change = 0;
  let tokens = 0;
  for (const sample of samples) {
    const windowChange = sample[window];
    if (windowChange === undefined) continue;
    change += windowChange;
    tokens += sample.tokens;
  }
  return tokens === 0 ? undefined : change / tokens;
}
