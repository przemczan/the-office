import { Injectable } from "@nestjs/common";
import { PendingSignIns } from "../../application/pending-sign-ins.js";
import { isOn } from "../../domain/authenticator.js";
import type { User } from "../../domain/user.js";
import { AuthenticatorRepository } from "../../ports/authenticator-repository.js";
import { SecondSteps, type SecondStep } from "../../ports/second-steps.js";

/**
 * Asks a user whose authenticator is on for its code (spec §2.10): instead of a signed-in device,
 * a pending sign-in waits for it.
 */
@Injectable()
export class AuthenticatorSecondStep extends SecondSteps {
  constructor(
    private readonly authenticators: AuthenticatorRepository,
    private readonly pendingSignIns: PendingSignIns,
  ) {
    super();
  }

  async after(user: User): Promise<SecondStep | undefined> {
    if (!isOn(await this.authenticators.find(user.id))) return undefined;
    return { outcome: "code-needed", pendingToken: await this.pendingSignIns.start(user.id) };
  }
}
