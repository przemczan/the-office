import { Injectable } from "@nestjs/common";

/**
 * Runs the work that reads or changes the kept sign-in one piece after another. GitHub replaces
 * both tokens on each refresh, so two refreshes at once would leave the sign-in with a spent
 * refresh token; and a token from GitHub mustn't be kept after the sign-out, or the new App, that
 * came in while GitHub was being asked for it.
 */
@Injectable()
export class SignInChanges {
  private last: Promise<unknown> = Promise.resolve();

  run<T>(work: () => Promise<T>): Promise<T> {
    const next = this.last.then(work);
    this.last = next.catch(() => undefined);
    return next;
  }
}
