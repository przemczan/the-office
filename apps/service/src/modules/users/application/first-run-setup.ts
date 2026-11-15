import { randomInt, timingSafeEqual } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { Schedule } from "../../../platform/schedule/schedule.js";
import {
  afterFirstUser,
  basicsOf,
  isTokenWaiting,
  withBasicsClosed,
  withSetupToken,
  type BasicsState,
  type FirstRunSetupState,
} from "../domain/first-run-setup.js";
import {
  SETUP_TOKEN_ALPHABET,
  SETUP_TOKEN_LENGTH,
  setupTokenAsTyped,
  shownSetupToken,
} from "../domain/setup-token.js";
import { FirstRunBasicsClosed, SetupTokenMade } from "../domain/user-events.js";
import { FirstUserExists, SetupTokenRefused } from "../domain/user-refused.js";
import { FirstRunSetupRepository } from "../ports/first-run-setup-repository.js";
import { UserRepository } from "../ports/user-repository.js";
import { tokenHashOf } from "./sign-in-tokens.js";

/**
 * What the service's start did about the setup token: made one to print, found one waiting, or
 * none needed, the first user being made.
 */
export type TokenAtStart =
  | { readonly kind: "made"; readonly token: string }
  | { readonly kind: "waiting" }
  | { readonly kind: "not-needed" };

const WAITING: TokenAtStart = { kind: "waiting" };

/** How the install set First-run setup up: `OFFICE_SKIP_SETUP_BASICS` closes the basics at once. */
export class FirstRunSetupOptions {
  constructor(readonly skipBasics: boolean) {}
}

/**
 * First-run setup (spec §2.10): the one-time setup token printed on the host, which alone unlocks
 * the first user, then the basics the first user is walked through until they close them. Only the
 * token's hash is kept; the token itself is answered once, to be printed, and never logged.
 */
@Injectable()
export class FirstRunSetup {
  constructor(
    private readonly setups: FirstRunSetupRepository,
    private readonly users: UserRepository,
    private readonly options: FirstRunSetupOptions,
    private readonly schedule: Schedule,
    private readonly eventBus: EventBus,
  ) {}

  /**
   * A new setup token, grouped as printed, ending any earlier one. Throws FirstUserExists once a
   * user exists: a lost password is the set-password command's.
   */
  async newToken(): Promise<string> {
    if (await this.users.anyExists()) throw new FirstUserExists();
    const token = newSetupToken();
    const now = this.schedule.now();
    await this.setups.save(withSetupToken(await this.setups.find(), hashOf(token), now));
    await this.eventBus.publish(new SetupTokenMade(now));
    return token;
  }

  /**
   * At the service's start: a new token while the first user is awaited and none waits, so a
   * restart never replaces the one the install printed.
   */
  async tokenAtStart(): Promise<TokenAtStart> {
    if (await this.users.anyExists()) return { kind: "not-needed" };
    if (isTokenWaiting(await this.setups.find())) return WAITING;
    const token = newSetupToken();
    const now = this.schedule.now();
    if (!(await this.setups.saveTokenIfNoneWaiting(hashOf(token), now))) return WAITING;
    await this.eventBus.publish(new SetupTokenMade(now));
    return { kind: "made", token };
  }

  /** Throws SetupTokenRefused unless `typed` is the waiting token, dashes, spaces and case aside. */
  async checkToken(typed: string): Promise<void> {
    const { setupTokenHash } = await this.setups.find();
    if (setupTokenHash === null || !sameHash(hashOf(typed), setupTokenHash)) {
      throw new SetupTokenRefused();
    }
  }

  /** First-run setup as the first user's transaction saves it: the token used up, the basics open. */
  async afterFirstUser(at: Date): Promise<FirstRunSetupState> {
    return afterFirstUser(await this.setups.find(), at, this.options.skipBasics);
  }

  async basics(): Promise<BasicsState> {
    return basicsOf(await this.setups.find());
  }

  /** Closes the basics for good; closing them again changes nothing. */
  async closeBasics(): Promise<void> {
    const setup = await this.setups.find();
    if (basicsOf(setup) === "closed") return;
    const now = this.schedule.now();
    await this.setups.save(withBasicsClosed(setup, now));
    await this.eventBus.publish(new FirstRunBasicsClosed(now));
  }
}

function newSetupToken(): string {
  const characters = Array.from(
    { length: SETUP_TOKEN_LENGTH },
    () => SETUP_TOKEN_ALPHABET[randomInt(SETUP_TOKEN_ALPHABET.length)],
  ).join("");
  return shownSetupToken(characters);
}

function hashOf(token: string): string {
  return tokenHashOf(setupTokenAsTyped(token));
}

// Both are SHA-256 in hex, of one length; compared in constant time all the same.
function sameHash(typedHash: string, keptHash: string): boolean {
  const typed = Buffer.from(typedHash, "hex");
  const kept = Buffer.from(keptHash, "hex");
  return typed.length === kept.length && timingSafeEqual(typed, kept);
}
