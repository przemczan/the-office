/** What a check found that decides whether Update can go ahead. */
export interface CheckoutState {
  readonly localChanges: boolean;
  /** The checkout's upstream branch, such as `origin/main`; absent when it has none. */
  readonly upstream: string | undefined;
  /** Commits the checkout has that its upstream doesn't. */
  readonly ahead: number;
}

export const NO_LAUNCHER =
  "The Office wasn't started by its launcher (npm start), so it can't update itself.";
export const LOCAL_CHANGES = "The Office's checkout has local changes.";
export const NO_UPSTREAM = "The Office's checkout has no upstream branch.";

export function diverged(upstream: string): string {
  return `The Office's checkout has diverged from ${upstream}.`;
}

/**
 * Why Update is refused, or undefined when it can go ahead: a fast-forward of a clean checkout to
 * its upstream, under the launcher, on a system where it runs.
 */
export function updateRefusal(
  state: CheckoutState,
  { launched, systemRefusal }: { readonly launched: boolean; readonly systemRefusal?: string },
): string | undefined {
  if (systemRefusal) return systemRefusal;
  if (!launched) return NO_LAUNCHER;
  if (state.localChanges) return LOCAL_CHANGES;
  if (!state.upstream) return NO_UPSTREAM;
  if (state.ahead > 0) return diverged(state.upstream);
  return undefined;
}
