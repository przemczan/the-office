import { Injectable } from "@nestjs/common";
import type { SignInRequest } from "../domain/signed-in-device.js";
import type { SignInWayKind } from "../domain/sign-in-way.js";
import type { User } from "../domain/user.js";
import { SecondSteps } from "../ports/second-steps.js";
import { SignedInDevices } from "./signed-in-devices.js";

/** How a sign-in ended: signed in, with the new device's token for its cookie. */
export interface SignInOutcome {
  readonly outcome: "signed-in";
  readonly token: string;
  readonly signedInDeviceId: string;
}

/**
 * Where every way of signing in ends (spec §2.10), once it has found the user: a second step when
 * `SecondSteps` asks for one, such as an authenticator code, else a new signed-in device.
 */
@Injectable()
export class SignIns {
  constructor(
    private readonly secondSteps: SecondSteps,
    private readonly signedInDevices: SignedInDevices,
  ) {}

  async finish(user: User, way: SignInWayKind, request: SignInRequest): Promise<SignInOutcome> {
    const secondStep = await this.secondSteps.after(user, way);
    // No second step exists yet; the authenticator's Task answers with the outcome asking for it.
    if (secondStep !== undefined) return secondStep;
    const { token, device } = await this.signedInDevices.signIn(user.id, request);
    return { outcome: "signed-in", token, signedInDeviceId: device.id };
  }
}
