import type { OfficeCommit } from "../domain/office-commit.js";
import type { CheckoutState } from "../domain/update-refusal.js";

/** What reading the checkout against its freshly fetched upstream found. */
export interface UpstreamRead extends CheckoutState {
  readonly current: OfficeCommit;
  /** The upstream's newest commit; absent without an upstream. */
  readonly newest: OfficeCommit | undefined;
  /** The commits the checkout is behind its upstream, newest first. */
  readonly behind: readonly OfficeCommit[];
  /** Why the upstream couldn't be fetched; the rest is then read from what was fetched before. */
  readonly fetchProblem: string | undefined;
}

/**
 * The Office's own git checkout, the one its service runs from. Read with plain git as the
 * service's user: it is no Project, so the Office identity has no part in it.
 */
export abstract class OfficeCheckout {
  /** The commit checked out now. */
  abstract current(): Promise<OfficeCommit>;

  /** Fetches the checkout's upstream, then reads how far behind it the checkout is. */
  abstract readUpstream(): Promise<UpstreamRead>;
}
