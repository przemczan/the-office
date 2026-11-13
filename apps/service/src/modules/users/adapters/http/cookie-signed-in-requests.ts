import type { IncomingMessage } from "node:http";
import { Injectable } from "@nestjs/common";
import { EventBus, type Unsubscribe } from "../../../../platform/events/event-bus.js";
import { SignedInRequests, type SignedIn } from "../../../../platform/http/signed-in-requests.js";
import { SignedInDevices } from "../../application/signed-in-devices.js";
import { SignedOut } from "../../domain/user-events.js";
import { signInTokenOf } from "./sign-in-cookie.js";

/** The platform's guard and WebSocket ask here which signed-in device a request's cookie names. */
@Injectable()
export class CookieSignedInRequests extends SignedInRequests {
  constructor(
    private readonly signedInDevices: SignedInDevices,
    private readonly eventBus: EventBus,
  ) {
    super();
  }

  async signedInOf(request: IncomingMessage): Promise<SignedIn | undefined> {
    const token = signInTokenOf(request.headers.cookie);
    if (token === undefined) return undefined;
    const device = await this.signedInDevices.signedInOf(token);
    return device && { userId: device.userId, signedInDeviceId: device.id };
  }

  onSignedOut(listener: (signedInDeviceIds: readonly string[]) => void): Unsubscribe {
    return this.eventBus.subscribe(SignedOut, (event) => listener(event.signedInDeviceIds));
  }
}
