import { randomBytes } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { encodeBase32UpperCaseNoPadding } from "@oslojs/encoding";
import { EventBus } from "../../../platform/events/event-bus.js";
import { Schedule } from "../../../platform/schedule/schedule.js";
import { isOn, keyUriOf, matchingStep } from "../domain/authenticator.js";
import { SignInRefused } from "../domain/sign-in-refused.js";
import {
  AuthenticatorRemoved,
  AuthenticatorSetUp,
  RecoveryCodesMade,
} from "../domain/user-events.js";
import { UserRefused } from "../domain/user-refused.js";
import { AuthenticatorRepository } from "../ports/authenticator-repository.js";
import { UserRepository } from "../ports/user-repository.js";
import { AuthenticatorCodes, type CodeAnswer } from "./authenticator-codes.js";
import { newRecoveryCodes, recoveryCodeHashOf } from "./recovery-code-secrets.js";

/** The secret's length: 160 bits, as RFC 4226 recommends for SHA-1. */
const SECRET_BYTES = 20;

/** Whether a user's authenticator is on, and how many unused recovery codes they have left. */
export type AuthenticatorState =
  { readonly state: "off" } | { readonly state: "on"; readonly recoveryCodesLeft: number };

/** What the user's authenticator app needs to be set up: the QR code's address, or its key typed. */
export interface AuthenticatorSetup {
  readonly keyUri: string;
  readonly secret: string;
}

/**
 * A user's own authenticator (spec §2.10): set up from their account and on once confirmed with a
 * first code, which shows the recovery codes once; turned off with a code or a recovery code, or by
 * the host command.
 */
@Injectable()
export class Authenticators {
  constructor(
    private readonly authenticators: AuthenticatorRepository,
    private readonly users: UserRepository,
    private readonly codes: AuthenticatorCodes,
    private readonly schedule: Schedule,
    private readonly eventBus: EventBus,
  ) {}

  async stateOf(userId: string): Promise<AuthenticatorState> {
    if (!isOn(await this.authenticators.find(userId))) return { state: "off" };
    return { state: "on", recoveryCodesLeft: await this.authenticators.recoveryCodesLeft(userId) };
  }

  /**
   * A new secret, in place of any not yet confirmed; the only time it leaves The Office. Throws
   * UserRefused while the authenticator is on.
   */
  async setUp(userId: string): Promise<AuthenticatorSetup> {
    const user = await this.users.find(userId);
    if (user === undefined) throw new UserRefused(["No such user."]);
    const secret = new Uint8Array(randomBytes(SECRET_BYTES));
    const kept = await this.authenticators.replaceUnconfirmed({
      userId,
      secret,
      confirmedAt: undefined,
      lastUsedStep: undefined,
      createdAt: this.schedule.now(),
    });
    if (!kept) throw new UserRefused(["The authenticator is already on."]);
    return { keyUri: keyUriOf(secret, user.email), secret: encodeBase32UpperCaseNoPadding(secret) };
  }

  /**
   * Turns the authenticator on with its first code, which can't be used again, and answers the
   * recovery codes, shown this once. A wrong code doesn't count toward the lockout: it proves
   * nothing about signing in.
   */
  async confirm(userId: string, code: string): Promise<readonly string[]> {
    const authenticator = await this.authenticators.find(userId);
    if (authenticator === undefined || isOn(authenticator)) {
      throw new UserRefused(["Set up the authenticator first."]);
    }
    const now = this.schedule.now();
    const step = matchingStep(authenticator, code, now);
    if (step === undefined) throw SignInRefused.wrong("code");
    const recoveryCodes = newRecoveryCodes();
    const confirmed = await this.authenticators.confirm(
      userId,
      step,
      now,
      recoveryCodes.map(recoveryCodeHashOf),
    );
    if (!confirmed) throw new UserRefused(["Set up the authenticator first."]);
    await this.eventBus.publish(new AuthenticatorSetUp(userId));
    await this.eventBus.publish(new RecoveryCodesMade(userId, recoveryCodes.length));
    return recoveryCodes;
  }

  /** Turns the authenticator off with a code or a recovery code; its recovery codes go with it. */
  async turnOff(userId: string, answer: CodeAnswer): Promise<void> {
    await this.codes.check(userId, answer);
    await this.remove(userId);
  }

  /** Removes the user's authenticator and recovery codes, as the host command does. */
  async remove(userId: string): Promise<void> {
    if (await this.authenticators.remove(userId)) {
      await this.eventBus.publish(new AuthenticatorRemoved(userId));
    }
  }

  /** Makes new recovery codes with a code, the old ones no longer working; answers them once. */
  async newRecoveryCodes(userId: string, code: string): Promise<readonly string[]> {
    await this.codes.check(userId, { code });
    const recoveryCodes = newRecoveryCodes();
    const replaced = await this.authenticators.replaceRecoveryCodes(
      userId,
      recoveryCodes.map(recoveryCodeHashOf),
      this.schedule.now(),
    );
    if (!replaced) throw new UserRefused(["Turn the authenticator on first."]);
    await this.eventBus.publish(new RecoveryCodesMade(userId, recoveryCodes.length));
    return recoveryCodes;
  }
}
