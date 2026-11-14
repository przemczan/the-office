import { randomBytes } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { Schedule } from "../../../platform/schedule/schedule.js";
import { isUnderway, type IdentityTrip, type TripPurpose } from "../domain/identity-trip.js";
import type { IdentityProviderId } from "../domain/linked-identity.js";

/**
 * Trips under way at once, beyond which the oldest are dropped: the sign-in's start needs no
 * signed-in device, so anyone can start trips.
 */
export const IDENTITY_TRIPS_CAP = 1000;

/** A trip as it starts: the state and PKCE's verifier it carries to the provider. */
export interface StartedTrip {
  readonly state: string;
  readonly codeVerifier: string;
}

export interface NewTrip {
  readonly provider: IdentityProviderId;
  readonly purpose: TripPurpose;
  readonly redirectUri: string;
  readonly returnTo: string;
}

/**
 * The trips to a provider under way, each by its unguessable state, kept in memory for ten minutes
 * and taken once, whatever comes of it. A restart loses them, which only means starting again.
 */
@Injectable()
export class IdentityTrips {
  private readonly trips = new Map<string, IdentityTrip>();

  constructor(private readonly schedule: Schedule) {}

  start(trip: NewTrip): StartedTrip {
    const now = this.schedule.now();
    this.dropEnded(now);
    const state = randomBytes(32).toString("base64url");
    const codeVerifier = randomBytes(32).toString("base64url");
    this.trips.set(state, { ...trip, codeVerifier, startedAt: now });
    return { state, codeVerifier };
  }

  /** The trip of this state, while under way; it is forgotten either way. */
  take(state: string | undefined): IdentityTrip | undefined {
    if (state === undefined) return undefined;
    const trip = this.trips.get(state);
    this.trips.delete(state);
    return trip !== undefined && isUnderway(trip, this.schedule.now()) ? trip : undefined;
  }

  private dropEnded(now: Date): void {
    for (const [state, trip] of this.trips) {
      if (!isUnderway(trip, now)) this.trips.delete(state);
    }
    // A Map keeps the order trips started in, so the first are the oldest.
    for (const state of this.trips.keys()) {
      if (this.trips.size < IDENTITY_TRIPS_CAP) break;
      this.trips.delete(state);
    }
  }
}
