import { createTOTPKeyURI, verifyHOTP } from "@oslojs/otp";

/** The standard codes (spec §2.10 Defaults, "The authenticator"): 6 digits, a new one each 30 s. */
const CODE_DIGITS = 6;
const STEP_SECONDS = 30;
/** The steps either side of now whose code is still taken, for a phone's clock a little off. */
const DRIFT_STEPS = 1;
const ISSUER = "The Office";
const CODE_SHAPE = /^\d{6}$/;

/**
 * A user's authenticator app (spec §2.10): the secret it shares with The Office, which must stay
 * readable to check codes, and the last time step whose code was taken, so no code is taken twice.
 * It is on only once confirmed with a first code.
 */
export interface Authenticator {
  readonly userId: string;
  readonly secret: Uint8Array;
  readonly confirmedAt: Date | undefined;
  readonly lastUsedStep: number | undefined;
  readonly createdAt: Date;
}

/** Whether the authenticator is on: set up and confirmed with a first code. */
export function isOn(authenticator: Authenticator | undefined): authenticator is Authenticator {
  return authenticator?.confirmedAt !== undefined;
}

/** The 30-second time step `now` falls in, counted from the Unix epoch as TOTP counts it. */
export function timeStepAt(now: Date): number {
  return Math.floor(now.getTime() / 1000 / STEP_SECONDS);
}

/**
 * The time step whose code this is, within one step of now; undefined for a wrong code, one not
 * shaped as a code, or one of a step already taken (at or before `lastUsedStep`).
 */
export function matchingStep(
  authenticator: Authenticator,
  typed: string,
  now: Date,
): number | undefined {
  const code = typed.replaceAll(/\s/g, "");
  if (!CODE_SHAPE.test(code)) return undefined;
  const current = timeStepAt(now);
  for (let step = current - DRIFT_STEPS; step <= current + DRIFT_STEPS; step += 1) {
    const taken = authenticator.lastUsedStep !== undefined && step <= authenticator.lastUsedStep;
    if (!taken && verifyHOTP(authenticator.secret, BigInt(step), CODE_DIGITS, code)) return step;
  }
  return undefined;
}

/** The `otpauth://` address an authenticator app reads from the QR code, naming the user's email. */
export function keyUriOf(secret: Uint8Array, email: string): string {
  return createTOTPKeyURI(ISSUER, email, secret, STEP_SECONDS, CODE_DIGITS);
}
