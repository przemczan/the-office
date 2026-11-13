import type { IncomingMessage } from "node:http";
import { Injectable } from "@nestjs/common";
import { EventBus, type Unsubscribe } from "../../../../platform/events/event-bus.js";
import { SignedInRequests, type SignedIn } from "../../../../platform/http/signed-in-requests.js";
import { Accounts } from "../../application/accounts.js";
import { SignedInDevices } from "../../application/signed-in-devices.js";
import { SignedOut } from "../../domain/user-events.js";
import { signInTokenOf } from "./sign-in-cookie.js";

/** The platform's guard and WebSocket ask here which signed-in device a request's cookie names. */
@Injectable()
export class CookieSignedInRequests extends SignedInRequests {
  constructor(
    private readonly signedInDevices: SignedInDevices,
    private readonly accounts: Accounts,
    private readonly eventBus: EventBus,
  ) {
    super();
  }

  async signedInOf(request: IncomingMessage): Promise<SignedIn | undefined> {
    const token = signInTokenOf(request.headers.cookie);
    if (token === undefined) return undefined;
    const device = await this.signedInDevices.signedInOf(token);
    if (device === undefined) return undefined;
    const user = await this.accounts.of(device.userId);
    return user && { userId: user.id, name: user.name, signedInDeviceId: device.id };
  }

  onSignedOut(listener: (signedInDeviceIds: readonly string[]) => void): Unsubscribe {
    return this.eventBus.subscribe(SignedOut, (event) => listener(event.signedInDeviceIds));
  }

  signedOutAmong(signedInDeviceIds: readonly string[]): Promise<readonly string[]> {
    return this.signedInDevices.signedOutAmong(signedInDeviceIds);
  }
}
