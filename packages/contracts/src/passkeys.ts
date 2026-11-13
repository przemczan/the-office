import { z } from "zod";
import { wayUnavailableReasonSchema } from "./users.js";

// The WebAuthn JSON a browser and The Office pass each other while a passkey is added or used, as
// the WebAuthn spec's JSON forms define it, kept apart from any library's types. Every binary
// value is base64url.

const base64url = z.string().regex(/^[\w-]*$/, "Give a base64url value.");

const userVerificationSchema = z.enum(["discouraged", "preferred", "required"]);

const credentialDescriptorSchema = z.object({
  id: base64url,
  type: z.literal("public-key"),
  transports: z.array(z.string()).optional(),
});

/** What `POST /account/passkeys/options` answers: the browser makes a passkey with these. */
export const passkeyCreationOptionsSchema = z.object({
  rp: z.object({ name: z.string(), id: z.string().optional() }),
  user: z.object({ id: base64url, name: z.string(), displayName: z.string() }),
  challenge: base64url,
  pubKeyCredParams: z.array(z.object({ alg: z.number(), type: z.literal("public-key") })),
  timeout: z.number().optional(),
  excludeCredentials: z.array(credentialDescriptorSchema).optional(),
  authenticatorSelection: z
    .object({
      authenticatorAttachment: z.enum(["cross-platform", "platform"]).optional(),
      requireResidentKey: z.boolean().optional(),
      residentKey: z.enum(["discouraged", "preferred", "required"]).optional(),
      userVerification: userVerificationSchema.optional(),
    })
    .optional(),
  attestation: z.enum(["direct", "enterprise", "indirect", "none"]).optional(),
});
export type PasskeyCreationOptions = z.infer<typeof passkeyCreationOptionsSchema>;

/** What `POST /sign-in/passkey/options` answers: the browser signs in with a passkey with these. */
export const passkeyRequestOptionsSchema = z.object({
  challenge: base64url,
  timeout: z.number().optional(),
  rpId: z.string().optional(),
  allowCredentials: z.array(credentialDescriptorSchema).optional(),
  userVerification: userVerificationSchema.optional(),
});
export type PasskeyRequestOptions = z.infer<typeof passkeyRequestOptionsSchema>;

const credentialSchema = z.object({
  id: base64url,
  rawId: base64url,
  type: z.literal("public-key"),
  authenticatorAttachment: z.enum(["cross-platform", "platform"]).optional(),
});

/** The new passkey as the browser made it. */
export const passkeyRegistrationSchema = credentialSchema.extend({
  response: z.object({
    clientDataJSON: base64url,
    attestationObject: base64url,
    authenticatorData: base64url.optional(),
    transports: z.array(z.string()).optional(),
    publicKeyAlgorithm: z.number().optional(),
    publicKey: base64url.optional(),
  }),
});
export type PasskeyRegistration = z.infer<typeof passkeyRegistrationSchema>;

/** `POST /sign-in/passkey`: the passkey's answer to the challenge, which names its user. */
export const passkeyAuthenticationSchema = credentialSchema.extend({
  response: z.object({
    clientDataJSON: base64url,
    authenticatorData: base64url,
    signature: base64url,
    userHandle: base64url.optional(),
  }),
});
export type PasskeyAuthentication = z.infer<typeof passkeyAuthenticationSchema>;

/** A passkey's name, as the user gives it: 1 to 60 characters. */
export const PASSKEY_NAME_MAX_LENGTH = 60;

/** `POST /account/passkeys/options`: the current password, asked again before adding a passkey. */
export const passkeyAddingSchema = z.object({ currentPassword: z.string() });
export type PasskeyAdding = z.infer<typeof passkeyAddingSchema>;

/** `POST /account/passkeys`: the new passkey and the name the user gave it. */
export const newPasskeySchema = z.object({
  name: z.string(),
  registration: passkeyRegistrationSchema,
});
export type NewPasskey = z.infer<typeof newPasskeySchema>;

/** `PATCH /account/passkeys/:id`: a new name. */
export const passkeyRenameSchema = z.object({ name: z.string() });
export type PasskeyRename = z.infer<typeof passkeyRenameSchema>;

/**
 * Where a passkey works, told against the page's address: here; at The Office's other address
 * (`localhost` or the public address), `otherAddress` being the public address to open; or at an
 * address that is no longer The Office's, such as an earlier public address.
 */
export const passkeyAtSchema = z.enum(["this-address", "other-address", "old-address"]);
export type PasskeyAt = z.infer<typeof passkeyAtSchema>;

/** One of the signed-in user's passkeys; `rpId` is the address it was added at. */
export const passkeySchema = z.object({
  id: z.string(),
  name: z.string(),
  rpId: z.string(),
  at: passkeyAtSchema,
  otherAddress: z.string().optional(),
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime().nullable(),
});
export type Passkey = z.infer<typeof passkeySchema>;

/**
 * `GET /account/passkeys`: the user's passkeys, and why adding one doesn't work at this address,
 * with where it does, or null when it does.
 */
export const passkeyListSchema = z.object({
  passkeys: z.array(passkeySchema),
  addingUnavailable: z
    .object({ reason: wayUnavailableReasonSchema, elsewhere: z.string().optional() })
    .nullable(),
});
export type PasskeyList = z.infer<typeof passkeyListSchema>;
