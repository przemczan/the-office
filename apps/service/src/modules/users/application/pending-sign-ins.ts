import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { Schedule } from "../../../platform/schedule/schedule.js";
import { isPending, pendingSignInOf, type PendingSignIn } from "../domain/pending-sign-in.js";
import { PendingSignInRepository } from "../ports/pending-sign-in-repository.js";
import { newSignInToken, tokenHashOf } from "./sign-in-tokens.js";

/** Sign-ins waiting for the user's authenticator code (spec §2.10), each used up once. */
@Injectable()
export class PendingSignIns {
  constructor(
    private readonly pendingSignIns: PendingSignInRepository,
    private readonly schedule: Schedule,
  ) {}

  /** Starts one for the user; answers its token, which its cookie carries and nothing keeps. */
  async start(userId: string): Promise<string> {
    const now = this.schedule.now();
    await this.pendingSignIns.removeExpired(now);
    const token = newSignInToken();
    await this.pendingSignIns.add(pendingSignInOf(randomUUID(), userId, tokenHashOf(token), now));
    return token;
  }

  /** The pending sign-in a token names while it waits: not used up and not expired. */
  async pendingOf(token: string): Promise<PendingSignIn | undefined> {
    const pendingSignIn = await this.pendingSignIns.findByTokenHash(tokenHashOf(token));
    if (pendingSignIn === undefined || !isPending(pendingSignIn, this.schedule.now())) {
      return undefined;
    }
    return pendingSignIn;
  }

  /** Ends every one of the user's, such as when they are removed. */
  async endAllOf(userId: string): Promise<void> {
    await this.pendingSignIns.removeAllOf(userId);
  }

  /** Uses it up; says whether it was still there, so two requests can't both use it. */
  useUp(pendingSignIn: PendingSignIn): Promise<boolean> {
    return this.pendingSignIns.remove(pendingSignIn.id);
  }
}
