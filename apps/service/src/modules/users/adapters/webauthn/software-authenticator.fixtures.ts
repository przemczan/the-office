import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";
import { isoCBOR } from "@simplewebauthn/server/helpers";
import type {
  PasskeyAuthentication,
  PasskeyCreationOptions,
  PasskeyRegistration,
  PasskeyRequestOptions,
} from "@the-office/contracts";

/** What a test may make the authenticator or its browser get wrong. */
export interface Tampering {
  /** The page's origin the browser reports; the options' relying party's own otherwise. */
  readonly origin?: string;
  /** The relying party the authenticator signs for; the options' own otherwise. */
  readonly rpId?: string;
  /** Whether the user was verified, by a PIN or a fingerprint; true unless told. */
  readonly userVerified?: boolean;
}

const FLAG_USER_PRESENT = 0x01;
const FLAG_USER_VERIFIED = 0x04;
const FLAG_ATTESTED_CREDENTIAL = 0x40;
const COSE_KEY_TYPE_EC2 = 2;
const COSE_ALG_ES256 = -7;
const COSE_CURVE_P256 = 1;

/**
 * A passkey authenticator in software, as a browser and a device would answer The Office: a P-256
 * key from `node:crypto`, a discoverable credential kept with its user handle, and real
 * attestation and assertion responses, built with the library's CBOR, which the service checks as
 * it checks a browser's.
 */
export class SoftwareAuthenticator {
  readonly credentialId = randomBytes(16).toString("base64url");
  /** The signature counter it reported last, counted up at each sign-in unless 0, as synced passkeys keep it. */
  counter: number;
  private readonly keys = generateKeyPairSync("ec", { namedCurve: "P-256" });
  private userHandle: string | undefined;
  private rpId: string | undefined;

  constructor({ counter = 0 }: { counter?: number } = {}) {
    this.counter = counter;
  }

  /** Makes the passkey for these options at `origin`, the page the browser is on. */
  register(
    options: PasskeyCreationOptions,
    origin: string,
    tampering: Tampering = {},
  ): PasskeyRegistration {
    const rpId = tampering.rpId ?? options.rp.id ?? new URL(origin).hostname;
    this.userHandle = options.user.id;
    this.rpId = rpId;
    const clientDataJSON = clientData(
      "webauthn.create",
      options.challenge,
      tampering.origin ?? origin,
    );
    const credentialId = Buffer.from(this.credentialId, "base64url");
    const length = Buffer.alloc(2);
    length.writeUInt16BE(credentialId.length);
    const authenticatorData = Buffer.concat([
      authenticatorDataOf(rpId, tampering, this.counter, FLAG_ATTESTED_CREDENTIAL),
      Buffer.alloc(16),
      length,
      credentialId,
      coseKeyOf(this.keys.publicKey),
    ]);
    const attestationObject = isoCBOR.encode(
      new Map<string, Uint8Array | string | Map<string, string>>([
        ["fmt", "none"],
        ["attStmt", new Map<string, string>()],
        ["authData", new Uint8Array(authenticatorData)],
      ]),
    );
    return {
      id: this.credentialId,
      rawId: this.credentialId,
      type: "public-key",
      authenticatorAttachment: "platform",
      response: {
        clientDataJSON: clientDataJSON.toString("base64url"),
        attestationObject: Buffer.from(attestationObject).toString("base64url"),
        transports: ["internal"],
      },
    };
  }

  /** Signs in with the passkey it made, answering these options at `origin`. */
  signIn(
    options: PasskeyRequestOptions,
    origin: string,
    tampering: Tampering & { readonly userHandle?: string } = {},
  ): PasskeyAuthentication {
    if (this.userHandle === undefined || this.rpId === undefined) {
      throw new Error("The authenticator has no passkey yet: register one first.");
    }
    const rpId = tampering.rpId ?? options.rpId ?? this.rpId;
    if (this.counter > 0) this.counter += 1;
    const clientDataJSON = clientData(
      "webauthn.get",
      options.challenge,
      tampering.origin ?? origin,
    );
    const authenticatorData = authenticatorDataOf(rpId, tampering, this.counter, 0);
    const signed = Buffer.concat([
      authenticatorData,
      createHash("sha256").update(clientDataJSON).digest(),
    ]);
    const signature = sign("sha256", signed, this.keys.privateKey);
    return {
      id: this.credentialId,
      rawId: this.credentialId,
      type: "public-key",
      authenticatorAttachment: "platform",
      response: {
        clientDataJSON: clientDataJSON.toString("base64url"),
        authenticatorData: authenticatorData.toString("base64url"),
        signature: signature.toString("base64url"),
        userHandle: tampering.userHandle ?? this.userHandle,
      },
    };
  }
}

function clientData(type: string, challenge: string, origin: string): Buffer {
  return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
}

function authenticatorDataOf(
  rpId: string,
  { userVerified = true }: Tampering,
  counter: number,
  moreFlags: number,
): Buffer {
  const flags = FLAG_USER_PRESENT | (userVerified ? FLAG_USER_VERIFIED : 0) | moreFlags;
  const counterBytes = Buffer.alloc(4);
  counterBytes.writeUInt32BE(counter);
  return Buffer.concat([
    createHash("sha256").update(rpId).digest(),
    Buffer.from([flags]),
    counterBytes,
  ]);
}

/** The public key as COSE, as an authenticator puts it in its attested credential data. */
function coseKeyOf(publicKey: KeyObject): Uint8Array {
  const { x, y } = publicKey.export({ format: "jwk" });
  if (x === undefined || y === undefined) throw new Error("The key has no coordinates.");
  return isoCBOR.encode(
    new Map<number, number | Uint8Array>([
      [1, COSE_KEY_TYPE_EC2],
      [3, COSE_ALG_ES256],
      [-1, COSE_CURVE_P256],
      [-2, new Uint8Array(Buffer.from(x, "base64url"))],
      [-3, new Uint8Array(Buffer.from(y, "base64url"))],
    ]),
  );
}
