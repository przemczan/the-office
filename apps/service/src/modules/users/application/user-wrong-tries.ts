import { Injectable } from "@nestjs/common";
import { Schedule } from "../../../platform/schedule/schedule.js";
import type { User } from "../domain/user.js";
import {
  NO_WRONG_TRIES,
  afterWrongTry,
  tryRefusal,
  type WrongTries,
} from "../domain/wrong-tries.js";
import { UserRepository } from "../ports/user-repository.js";

/** A try taken: the user with it counted wrong, and their tries before it. */
export interface TakenTry {
  readonly user: User;
  readonly before: WrongTries;
}

/**
 * A user's wrong tries at their password and codes, counted together (spec §2.10, "Slow-down and
 * lockout"). A try is counted wrong before it is checked, so tries sent at once can't slip past the
 * slow-down, and cleared or undone once it was right.
 */
@Injectable()
export class UserWrongTries {
  constructor(
    private readonly users: UserRepository,
    private readonly schedule: Schedule,
  ) {}

  /**
   * Takes a try, counted wrong until it is cleared or undone; throws `SignInRefused` when the
   * slow-down or the lockout takes none now. Undefined when there is no such user, or they were
   * removed.
   */
  async take(userId: string): Promise<TakenTry | undefined> {
    let before = NO_WRONG_TRIES;
    const user = await this.users.update(userId, (stored) => {
      if (stored.removedAt !== undefined) return undefined;
      const now = this.schedule.now();
      const refusal = tryRefusal(stored.wrongTries, now);
      if (refusal !== undefined) throw refusal;
      before = stored.wrongTries;
      return { ...stored, wrongTries: afterWrongTry(stored.wrongTries, now) };
    });
    if (user === undefined || user.removedAt !== undefined) return undefined;
    return { user, before };
  }

  /**
   * Undoes a right try's count, leaving the wrong ones before it: a step of the sign-in remains.
   * When other tries were counted since, the count stays as it is, so a right password sent
   * alongside wrong codes can't wipe them out.
   */
  async undo({ user, before }: TakenTry): Promise<void> {
    await this.users.update(user.id, (stored) =>
      stored.wrongTries.inARow === user.wrongTries.inARow
        ? { ...stored, wrongTries: before }
        : undefined,
    );
  }

  /** Clears the count: a right sign-in, or a right code, resets it. */
  async clear(userId: string): Promise<void> {
    await this.users.update(userId, (stored) =>
      stored.wrongTries.inARow === 0 ? undefined : { ...stored, wrongTries: NO_WRONG_TRIES },
    );
  }
}
