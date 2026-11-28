import type { IncomingMessage } from "node:http";
import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { OfficeAddresses } from "../../../../platform/http/office-addresses.js";
import { RequestsPerAddress } from "../../../../platform/http/requests-per-address.js";
import { Schedule } from "../../../../platform/schedule/schedule.js";

/** Sign-ins one address starts at once (spec §2.10 Defaults, "Sign-in starts"). */
export const SIGN_IN_STARTS_AT_ONCE = 20;
/** Then one more every this long: 20 a minute. */
export const SIGN_IN_START_EVERY_MS = 3_000;

export const TOO_MANY_SIGN_IN_STARTS =
  "Too many sign-ins were started from this address: wait a minute, then try again.";

/**
 * The starts of Continue with a provider and of a passkey sign-in, per address the request came
 * from: each keeps a trip or a ceremony in memory until it ends, and anyone can start one, so one
 * address must not start enough to push out the others' (`IDENTITY_TRIPS_CAP`,
 * `PENDING_CEREMONIES_CAP`).
 */
@Injectable()
export class SignInStarts {
  private readonly starts = new RequestsPerAddress(SIGN_IN_STARTS_AT_ONCE, SIGN_IN_START_EVERY_MS);

  constructor(
    private readonly addresses: OfficeAddresses,
    private readonly schedule: Schedule,
  ) {}

  /** Counts one start from the request's address; throws 429 past the limit. */
  take(request: IncomingMessage): void {
    if (!this.starts.take(this.addresses.clientOf(request), this.schedule.now())) {
      throw new HttpException(TOO_MANY_SIGN_IN_STARTS, HttpStatus.TOO_MANY_REQUESTS);
    }
  }
}
