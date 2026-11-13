import { Injectable } from "@nestjs/common";
import type { SignInRequest } from "../domain/signed-in-device.js";
import type { SignInWay } from "../domain/sign-in-way.js";
import type { User } from "../domain/user.js";
import { SecondSteps, type SecondStep } from "../ports/second-steps.js";
import { SignedInDevices } from "./signed-in-devices.js";
import { UserWrongTries } from "./user-wrong-tries.js";

/** Signed in, with the new device's token for its cookie. */
export interface SignedInOutcome {
  readonly outcome: "signed-in";
  readonly token: string;
  readonly signedInDeviceId: string;
}

/**
 * How a sign-in ended: signed in; waiting for a second step such as the authenticator code; or,
 * after a right one-time password, on to setting the user's own password, with no signed-in device
 * yet.
 */
export type SignInOutcome = SignedInOutcome | SecondStep | { readonly outcome: "set-password" };

/**
 * Where every way of signing in ends (spec §2.10), once it has found the user: a second step when
 * `SecondSteps` asks for one, such as an authenticator code, unless the way is enough alone, as a
 * passkey is; else a new signed-in device.
 */
@Injectable()
export class SignIns {
  constructor(
    private readonly secondSteps: SecondSteps,
    private readonly signedInDevices: SignedInDevices,
    private readonly wrongTries: UserWrongTries,
  ) {}

  async finish(
    user: User,
    way: SignInWay,
    request: SignInRequest,
  ): Promise<SignedInOutcome | SecondStep> {
    if (!way.enoughAlone) {
      const secondStep = await this.secondSteps.after(user);
      if (secondStep !== undefined) return secondStep;
    }
    return this.signIn(user, request);
  }

  /**
   * Signs the user in on a new device, their wrong tries reset, as a right sign-in resets them.
   * Called by `finish` and by the second step once it is done.
   */
  async signIn(user: User, request: SignInRequest): Promise<SignedInOutcome> {
    await this.wrongTries.clear(user.id);
    const { token, device } = await this.signedInDevices.signIn(user.id, request);
    return { outcome: "signed-in", token, signedInDeviceId: device.id };
  }
}
