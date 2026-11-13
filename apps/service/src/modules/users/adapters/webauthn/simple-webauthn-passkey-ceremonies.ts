import { Injectable, Logger } from "@nestjs/common";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { passkeyAuthenticationSchema, passkeyRegistrationSchema } from "@the-office/contracts";
import type { NewCredential, Passkey } from "../../domain/passkey.js";
import type { PendingCeremony } from "../../domain/pending-ceremony.js";
import type { RelyingParty } from "../../domain/relying-party.js";
import type { User } from "../../domain/user.js";
import {
  PasskeyCeremonies,
  type CeremonyAnswer,
  type CeremonyStart,
} from "../../ports/passkey-ceremonies.js";

/** The name a browser shows the user for the relying party. */
const RELYING_PARTY_NAME = "The Office";

/**
 * The ceremonies by `@simplewebauthn/server`: no attestation asked for (The Office trusts any
 * authenticator), a discoverable passkey required, and user verification required both ways.
 */
@Injectable()
export class SimpleWebAuthnPasskeyCeremonies extends PasskeyCeremonies {
  private readonly logger = new Logger(SimpleWebAuthnPasskeyCeremonies.name);

  async addingOptions(
    relyingParty: RelyingParty,
    user: User,
    existing: readonly Passkey[],
  ): Promise<CeremonyStart> {
    const options = await generateRegistrationOptions({
      rpName: RELYING_PARTY_NAME,
      rpID: relyingParty.rpId,
      userID: new TextEncoder().encode(user.id),
      userName: user.email,
      userDisplayName: user.name,
      attestationType: "none",
      excludeCredentials: existing.map((passkey) => ({
        id: passkey.credentialId,
        transports: [...passkey.transports],
      })),
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
    });
    return { challenge: options.challenge, options };
  }

  async checkAdding(
    answer: CeremonyAnswer,
    ceremony: PendingCeremony,
  ): Promise<NewCredential | undefined> {
    const response = passkeyRegistrationSchema.safeParse(answer.json);
    if (!response.success) return undefined;
    try {
      const { verified, registrationInfo } = await verifyRegistrationResponse({
        response: { ...response.data, clientExtensionResults: {} },
        expectedChallenge: ceremony.challenge,
        expectedOrigin: ceremony.relyingParty.origin,
        expectedRPID: ceremony.relyingParty.rpId,
        requireUserVerification: true,
      });
      if (!verified) return undefined;
      const { credential, credentialDeviceType, credentialBackedUp } = registrationInfo;
      return {
        credentialId: credential.id,
        publicKey: credential.publicKey,
        counter: credential.counter,
        transports: credential.transports ?? [],
        deviceType: credentialDeviceType === "multiDevice" ? "multi-device" : "single-device",
        backedUp: credentialBackedUp,
      };
    } catch (error) {
      this.logger.log(`A passkey wasn't added: ${String(error)}`);
      return undefined;
    }
  }

  async signingInOptions(relyingParty: RelyingParty): Promise<CeremonyStart> {
    // No allowed credentials: the browser offers every passkey it keeps for this relying party.
    const options = await generateAuthenticationOptions({
      rpID: relyingParty.rpId,
      allowCredentials: [],
      userVerification: "required",
    });
    return { challenge: options.challenge, options };
  }

  async checkSigningIn(
    answer: CeremonyAnswer,
    ceremony: PendingCeremony,
    passkey: Passkey,
  ): Promise<{ readonly counter: number } | undefined> {
    const response = passkeyAuthenticationSchema.safeParse(answer.json);
    if (!response.success) return undefined;
    try {
      const { verified, authenticationInfo } = await verifyAuthenticationResponse({
        response: { ...response.data, clientExtensionResults: {} },
        expectedChallenge: ceremony.challenge,
        expectedOrigin: ceremony.relyingParty.origin,
        expectedRPID: ceremony.relyingParty.rpId,
        credential: {
          id: passkey.credentialId,
          publicKey: new Uint8Array(passkey.publicKey),
          // The counter's rule is the caller's (`isPossibleClone`), which logs a possible copy, so
          // the library's own check is given nothing to compare against.
          counter: 0,
          transports: [...passkey.transports],
        },
        requireUserVerification: true,
      });
      return verified ? { counter: authenticationInfo.newCounter } : undefined;
    } catch (error) {
      this.logger.log(`A passkey didn't sign in: ${String(error)}`);
      return undefined;
    }
  }
}
