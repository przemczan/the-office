import { randomBytes } from "node:crypto";

/**
 * The `state` values of browser trips to GitHub under way, each taken once, within `lifetimeMs`.
 * Unguessable, so another site can't hand The Office a code it got from GitHub. Kept in memory:
 * a trip under way is lost on restart.
 */
export class PendingStates<Value> {
  private readonly pending = new Map<
    string,
    { readonly value: Value; readonly expiresAt: number }
  >();

  constructor(private readonly lifetimeMs: number) {}

  issue(value: Value): string {
    this.forgetExpired();
    const state = randomBytes(24).toString("base64url");
    this.pending.set(state, { value, expiresAt: Date.now() + this.lifetimeMs });
    return state;
  }

  /** The value issued with `state`, once; undefined for a state unknown, taken or expired. */
  take(state: string | undefined): Value | undefined {
    this.forgetExpired();
    if (state === undefined) return undefined;
    const entry = this.pending.get(state);
    this.pending.delete(state);
    return entry?.value;
  }

  private forgetExpired(): void {
    const now = Date.now();
    for (const [state, { expiresAt }] of this.pending) {
      if (expiresAt <= now) this.pending.delete(state);
    }
  }
}
