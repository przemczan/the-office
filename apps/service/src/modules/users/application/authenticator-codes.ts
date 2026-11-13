import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { Schedule } from "../../../platform/schedule/schedule.js";
import { isOn, matchingStep } from "../domain/authenticator.js";
import { RecoveryCodeUsed } from "../domain/user-events.js";
import { SignInRefused } from "../domain/sign-in-refused.js";
import { wrongTryAnswer } from "../domain/wrong-tries.js";
import { AuthenticatorRepository } from "../ports/authenticator-repository.js";
import { recoveryCodeHashOf } from "./recovery-code-secrets.js";
import { UserWrongTries } from "./user-wrong-tries.js";

/** What a user gives to prove they hold their authenticator: its code, or a recovery code. */
export type CodeAnswer = { readonly code: string } | { readonly recoveryCode: string };

/**
 * Checks a user's authenticator code or recovery code (spec §2.10), counted with their wrong
 * passwords toward the slow-down and the lockout. A code is taken once, a recovery code used up.
 */
@Injectable()
export class AuthenticatorCodes {
  constructor(
    private readonly authenticators: AuthenticatorRepository,
    private readonly wrongTries: UserWrongTries,
    private readonly schedule: Schedule,
    private readonly eventBus: EventBus,
  ) {}

  /**
   * Takes the code, the user's wrong tries cleared; throws `SignInRefused` when it is wrong or the
   * slow-down or the lockout takes no try now.
   */
  async check(userId: string, answer: CodeAnswer): Promise<void> {
    const taken = await this.wrongTries.take(userId);
    if (taken === undefined) throw SignInRefused.wrong("code");
    const right =
      "code" in answer
        ? await this.takeCode(userId, answer.code)
        : await this.useRecoveryCode(userId, answer.recoveryCode);
    if (!right) throw wrongTryAnswer(taken.user.wrongTries, "code");
    await this.wrongTries.clear(userId);
  }

  private async takeCode(userId: string, code: string): Promise<boolean> {
    const authenticator = await this.authenticators.find(userId);
    if (!isOn(authenticator)) return false;
    const step = matchingStep(authenticator, code, this.schedule.now());
    return step !== undefined && this.authenticators.takeStep(userId, step);
  }

  private async useRecoveryCode(userId: string, recoveryCode: string): Promise<boolean> {
    const used = await this.authenticators.useRecoveryCode(
      userId,
      recoveryCodeHashOf(recoveryCode),
      this.schedule.now(),
    );
    if (!used) return false;
    const left = await this.authenticators.recoveryCodesLeft(userId);
    await this.eventBus.publish(new RecoveryCodeUsed(userId, left));
    return true;
  }
}
