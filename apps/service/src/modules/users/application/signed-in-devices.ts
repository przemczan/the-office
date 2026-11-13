import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { Schedule } from "../../../platform/schedule/schedule.js";
import {
  isSignedIn,
  seenAt,
  signedInDeviceOf,
  type SignedInDevice,
  type SignInRequest,
} from "../domain/signed-in-device.js";
import { SignedIn, SignedOut } from "../domain/user-events.js";
import { SignedInDeviceNotFound } from "../domain/user-refused.js";
import { SignedInDeviceRepository } from "../ports/signed-in-device-repository.js";
import { newSignInToken, tokenHashOf } from "./sign-in-tokens.js";

/** A device just signed in, with the token its cookie carries; the token is kept nowhere else. */
export interface NewSignedInDevice {
  readonly token: string;
  readonly device: SignedInDevice;
}

/** Each user's signed-in devices (spec §2.10): signing one in, checking it, and signing them out. */
@Injectable()
export class SignedInDevices {
  constructor(
    private readonly devices: SignedInDeviceRepository,
    private readonly schedule: Schedule,
    private readonly eventBus: EventBus,
  ) {}

  /** Signs the user in on a new device. Only `SignIns.finish` calls it. */
  async signIn(userId: string, request: SignInRequest): Promise<NewSignedInDevice> {
    const token = newSignInToken();
    const now = this.schedule.now();
    const device = signedInDeviceOf(randomUUID(), userId, tokenHashOf(token), request, now);
    await this.devices.add(device);
    await this.eventBus.publish(new SignedIn(userId, device.id, now));
    return { token, device };
  }

  /** The device a token signs in, while it is signed in; its use is written now and then. */
  async signedInOf(token: string): Promise<SignedInDevice | undefined> {
    const device = await this.devices.findByTokenHash(tokenHashOf(token));
    const now = this.schedule.now();
    if (device === undefined || !isSignedIn(device, now)) return undefined;
    const seen = seenAt(device, now);
    if (seen === undefined) return device;
    await this.devices.saveLastSeen(seen);
    return seen;
  }

  /** The user's devices still signed in, the most recently used first. */
  async listOf(userId: string): Promise<readonly SignedInDevice[]> {
    const now = this.schedule.now();
    return (await this.devices.listOf(userId)).filter((device) => isSignedIn(device, now));
  }

  /** Signs out one of the user's devices; throws SignedInDeviceNotFound when it isn't theirs. */
  async signOut(userId: string, signedInDeviceId: string): Promise<void> {
    if (!(await this.devices.remove(userId, signedInDeviceId))) throw new SignedInDeviceNotFound();
    await this.eventBus.publish(new SignedOut(userId, [signedInDeviceId]));
  }

  /** Signs out every device of the user, as the host command and removing a user do. */
  async signOutAll(userId: string): Promise<void> {
    const signedOut = await this.devices.removeAllOf(userId);
    if (signedOut.length > 0) await this.eventBus.publish(new SignedOut(userId, signedOut));
  }
}
