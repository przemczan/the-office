import { Injectable, Logger } from "@nestjs/common";
import { Schedule } from "../../../platform/schedule/schedule.js";
import type { PageAddress } from "../domain/page-address.js";
import { isPossibleClone, usedAt, userHandleOf } from "../domain/passkey.js";
import {
  isPending,
  sameRelyingParty,
  signingInCeremonyOf,
  type PendingCeremony,
} from "../domain/pending-ceremony.js";
import { relyingPartyAt, type RelyingParty } from "../domain/relying-party.js";
import { SignInRefused } from "../domain/sign-in-refused.js";
import { PASSKEY_WAY } from "../domain/sign-in-way.js";
import type { SignInRequest } from "../domain/signed-in-device.js";
import { PasskeyCeremonies, type CeremonyAnswer } from "../ports/passkey-ceremonies.js";
import { PasskeyRepository } from "../ports/passkey-repository.js";
import { PendingCeremonies } from "../ports/pending-ceremonies.js";
import type { SecondStep } from "../ports/second-steps.js";
import { UserRepository } from "../ports/user-repository.js";
import { newSignInToken } from "./sign-in-tokens.js";
import { SignIns, type SignedInOutcome } from "./sign-ins.js";

/** A passkey sign-in started: the options for the browser, and the key its cookie carries. */
export interface PasskeySignInStart {
  readonly ceremonyKey: string;
  readonly options: unknown;
}

/**
 * Signing in with a passkey alone (spec §2.10): discoverable, so no email is asked, with user
 * verification required, and no second step after it. The lockout of the user's password doesn't
 * stop it: a passkey can't be guessed. Every failure is the same refusal.
 */
@Injectable()
export class PasskeySignIn {
  private readonly logger = new Logger(PasskeySignIn.name);

  constructor(
    private readonly passkeys: PasskeyRepository,
    private readonly ceremonies: PasskeyCeremonies,
    private readonly pendingCeremonies: PendingCeremonies,
    private readonly users: UserRepository,
    private readonly signIns: SignIns,
    private readonly schedule: Schedule,
  ) {}

  /** Starts a sign-in at the page's address, kept under a random key for the browser's cookie. */
  async start(page: PageAddress): Promise<PasskeySignInStart> {
    const relyingParty = relyingPartyOf(page);
    const { challenge, options } = await this.ceremonies.signingInOptions(relyingParty);
    const ceremonyKey = newSignInToken();
    const now = this.schedule.now();
    this.pendingCeremonies.keep(
      signingInKeyOf(ceremonyKey),
      signingInCeremonyOf(challenge, relyingParty, now),
      now,
    );
    return { ceremonyKey, options };
  }

  /**
   * Signs in the user whose passkey answered the ceremony the cookie's key names, or throws
   * `SignInRefused.passkey()`. The passkey must be this address's, name its own user, pass the
   * ceremony's checks and count up; its counter and last use are then saved.
   */
  async signIn(
    ceremonyKey: string | undefined,
    answer: CeremonyAnswer,
    page: PageAddress,
    request: SignInRequest,
  ): Promise<SignedInOutcome | SecondStep> {
    const relyingParty = relyingPartyOf(page);
    const ceremony = this.ceremonyFor(ceremonyKey, relyingParty);
    const passkey = await this.passkeys.findByCredentialId(answer.credentialId);
    if (
      passkey === undefined ||
      passkey.rpId !== relyingParty.rpId ||
      answer.userHandle !== userHandleOf(passkey.userId)
    ) {
      throw SignInRefused.passkey();
    }
    const user = await this.users.find(passkey.userId);
    if (user === undefined || user.removedAt !== undefined) throw SignInRefused.passkey();
    const checked = await this.ceremonies.checkSigningIn(answer, ceremony, passkey);
    if (checked === undefined) throw SignInRefused.passkey();
    if (isPossibleClone(passkey.counter, checked.counter)) {
      this.logger.warn(
        `Passkey ${passkey.id} of user ${passkey.userId} reported counter ${checked.counter}, not above ${passkey.counter}: it may have been copied, so it was refused.`,
      );
      throw SignInRefused.passkey();
    }
    await this.passkeys.save(usedAt(passkey, checked.counter, this.schedule.now()));
    return this.signIns.finish(user, PASSKEY_WAY, request);
  }

  private ceremonyFor(
    ceremonyKey: string | undefined,
    relyingParty: RelyingParty,
  ): PendingCeremony {
    const ceremony =
      ceremonyKey === undefined
        ? undefined
        : this.pendingCeremonies.take(signingInKeyOf(ceremonyKey));
    if (
      ceremony?.kind !== "signing-in" ||
      !isPending(ceremony, this.schedule.now()) ||
      !sameRelyingParty(ceremony.relyingParty, relyingParty)
    ) {
      throw SignInRefused.passkey();
    }
    return ceremony;
  }
}

function signingInKeyOf(ceremonyKey: string): string {
  return `signing-in:${ceremonyKey}`;
}

function relyingPartyOf(page: PageAddress): RelyingParty {
  const relyingParty = relyingPartyAt(page);
  if ("unavailable" in relyingParty) throw SignInRefused.passkey();
  return relyingParty.relyingParty;
}
