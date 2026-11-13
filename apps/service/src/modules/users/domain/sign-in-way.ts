import type { AddressKind } from "./address-kind.js";

/**
 * The ways to sign in (spec §2.10): a password now; Continue with GitHub, Continue with Google and
 * a passkey join as their Tasks add them, each with the addresses it works at.
 */
export type SignInWayKind = "password";

export interface SignInWay {
  readonly kind: SignInWayKind;
  /** Whether it works on a page opened at this kind of address. */
  worksAt(addressKind: AddressKind): boolean;
  /** Whether it is set up, such as an OAuth client entered; a password always is. */
  isAvailable(): Promise<boolean>;
}

/** A password works at every address. */
export const PASSWORD_WAY: SignInWay = {
  kind: "password",
  worksAt: () => true,
  isAvailable: () => Promise.resolve(true),
};
