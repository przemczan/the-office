// A release's signature (docs/releasing.md, "Signing a release"): the Release workflow signs each
// tarball's `.sha256` with the release key, and a direct install's update checks it against the
// public half pinned here, so a release whose assets someone else uploaded is never installed.
import { createPublicKey, verify } from "node:crypto";

/**
 * The release key's public half: an Ed25519 key, as base64 of its DER SubjectPublicKeyInfo
 * (`openssl pkey -pubout -outform DER | base64 -w0`). tools/install/install.sh pins the same key,
 * and its tests check the two match. Empty, signing is off: no signature is downloaded or checked.
 */
export const RELEASE_SIGNING_KEY = "";

/** What a `.sha256`'s signature is named by, beside it: `<tarball>.sha256.sig`. */
export const SIGNATURE_SUFFIX = ".sig";

/** Throws unless `signature` is the Ed25519 signature of `signed` by `publicKey` (as pinned). */
export function verifySignature(signed: Buffer, signature: Buffer, publicKey: string): void {
  const key = createPublicKey({
    key: Buffer.from(publicKey, "base64"),
    format: "der",
    type: "spki",
  });
  if (key.asymmetricKeyType !== "ed25519") {
    throw new Error(`The pinned release key is ${key.asymmetricKeyType}, not Ed25519.`);
  }
  if (!verify(null, signed, key, signature)) {
    throw new Error("The signature isn't the release key's.");
  }
}
