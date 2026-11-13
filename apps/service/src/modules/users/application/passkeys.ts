import { randomUUID } from "node:crypto";
import { Injectable, type OnModuleInit } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { Schedule } from "../../../platform/schedule/schedule.js";
import type { PageAddress } from "../domain/page-address.js";
import { passkeyNameProblems, passkeyOf, renamed, type Passkey } from "../domain/passkey.js";
import { addingCeremonyOf, isPending, sameRelyingParty } from "../domain/pending-ceremony.js";
import { relyingPartyAt, type RelyingParty } from "../domain/relying-party.js";
import {
  PasskeyAdded,
  PasskeyRemoved,
  PasskeyRenamed,
  UserRemoved,
} from "../domain/user-events.js";
import { PasskeyNotFound, UserRefused } from "../domain/user-refused.js";
import { PasskeyCeremonies, type CeremonyAnswer } from "../ports/passkey-ceremonies.js";
import { PasskeyRepository } from "../ports/passkey-repository.js";
import { PendingCeremonies } from "../ports/pending-ceremonies.js";
import { PasswordChecks } from "./password-checks.js";

/** Refused for every way adding fails after the browser's ceremony, which the user starts again. */
const NOT_ADDED = "The passkey wasn't added: start again.";
const NOT_HERE = "Passkeys don't work at this address.";

/**
 * A user's own passkeys (spec §2.10), from their account: listed, added after the current
 * password, renamed and removed. A removed user's passkeys go with them.
 */
@Injectable()
export class Passkeys implements OnModuleInit {
  constructor(
    private readonly passkeys: PasskeyRepository,
    private readonly ceremonies: PasskeyCeremonies,
    private readonly pendingCeremonies: PendingCeremonies,
    private readonly passwordChecks: PasswordChecks,
    private readonly schedule: Schedule,
    private readonly eventBus: EventBus,
  ) {}

  onModuleInit(): void {
    this.eventBus.subscribe(UserRemoved, ({ userId }) => this.passkeys.removeAllOf(userId));
  }

  listOf(userId: string): Promise<readonly Passkey[]> {
    return this.passkeys.listOf(userId);
  }

  /**
   * Options for adding a passkey at the page's address, once the current password is the user's,
   * so a stolen cookie can't add a lasting way in. The ceremony is tied to this signed-in device.
   * Throws UserRefused for a wrong password or an address passkeys don't work at, and
   * SignInRefused for the slow-down's wait or the lockout.
   */
  async startAdding(
    userId: string,
    signedInDeviceId: string,
    currentPassword: string,
    page: PageAddress,
  ): Promise<unknown> {
    const relyingParty = relyingPartyOf(page, NOT_HERE);
    const user = await this.passwordChecks.currentUserOf(userId, currentPassword);
    const existing = (await this.passkeys.listOf(userId)).filter(
      (passkey) => passkey.rpId === relyingParty.rpId,
    );
    const { challenge, options } = await this.ceremonies.addingOptions(
      relyingParty,
      user,
      existing,
    );
    const now = this.schedule.now();
    this.pendingCeremonies.keep(
      addingKeyOf(signedInDeviceId),
      addingCeremonyOf(challenge, relyingParty, userId, signedInDeviceId, now),
      now,
    );
    return options;
  }

  /**
   * Adds the passkey the browser made for the ceremony this device started, with the user's name
   * for it. Throws UserRefused for a name the rules refuse, and for any answer that fails: no such
   * ceremony, expired, another address, or a check the passkey fails.
   */
  async finishAdding(
    userId: string,
    signedInDeviceId: string,
    name: string,
    answer: CeremonyAnswer,
    page: PageAddress,
  ): Promise<Passkey> {
    const problems = passkeyNameProblems(name);
    if (problems.length > 0) throw new UserRefused(problems);
    const relyingParty = relyingPartyOf(page, NOT_ADDED);
    const ceremony = this.pendingCeremonies.take(addingKeyOf(signedInDeviceId));
    const now = this.schedule.now();
    if (
      ceremony?.kind !== "adding" ||
      ceremony.userId !== userId ||
      !isPending(ceremony, now) ||
      !sameRelyingParty(ceremony.relyingParty, relyingParty)
    ) {
      throw new UserRefused([NOT_ADDED]);
    }
    const credential = await this.ceremonies.checkAdding(answer, ceremony);
    // A credential kept already, by this user or another, is refused rather than left to the
    // table's unique credential id.
    if (
      credential === undefined ||
      (await this.passkeys.findByCredentialId(credential.credentialId)) !== undefined
    ) {
      throw new UserRefused([NOT_ADDED]);
    }
    const passkey = passkeyOf(randomUUID(), userId, name, relyingParty.rpId, credential, now);
    await this.passkeys.add(passkey);
    await this.eventBus.publish(new PasskeyAdded(userId, passkey.id, now));
    return passkey;
  }

  /** Renames the user's own passkey; throws UserRefused for a name the rules refuse. */
  async rename(userId: string, id: string, name: string): Promise<Passkey> {
    const problems = passkeyNameProblems(name);
    if (problems.length > 0) throw new UserRefused(problems);
    const passkey = await this.passkeys.find(userId, id);
    if (passkey === undefined) throw new PasskeyNotFound();
    const next = renamed(passkey, name);
    await this.passkeys.save(next);
    await this.eventBus.publish(new PasskeyRenamed(userId, id));
    return next;
  }

  /** Removes the user's own passkey; another user's is answered as one that doesn't exist. */
  async remove(userId: string, id: string): Promise<void> {
    if (!(await this.passkeys.remove(userId, id))) throw new PasskeyNotFound();
    await this.eventBus.publish(new PasskeyRemoved(userId, id));
  }
}

/** One adding ceremony per signed-in device: starting again replaces the one before. */
function addingKeyOf(signedInDeviceId: string): string {
  return `adding:${signedInDeviceId}`;
}

function relyingPartyOf(page: PageAddress, refusal: string): RelyingParty {
  const relyingParty = relyingPartyAt(page);
  if ("unavailable" in relyingParty) throw new UserRefused([refusal]);
  return relyingParty.relyingParty;
}
