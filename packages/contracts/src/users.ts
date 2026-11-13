import { z } from "zod";

/**
 * The kind of address a page was opened at (spec §2.10), which decides the ways to sign in it
 * offers.
 */
export const addressKindSchema = z.enum(["localhost", "loopback-ip", "local-network-ip", "public"]);
export type AddressKind = z.infer<typeof addressKindSchema>;

/**
 * A way to sign in the sign-in page offers. A union by `kind`, which Continue with GitHub, Continue
 * with Google and passkeys join as their Tasks add them.
 */
export const signInWaySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("password") }),
]);
export type SignInWay = z.infer<typeof signInWaySchema>;
export type SignInWayKind = SignInWay["kind"];

/**
 * `GET /sign-in`: whether The Office waits for its first user, whose form the page then shows,
 * and the ways that work at the address the page was opened at.
 */
export const signInPageSchema = z.object({
  firstRun: z.boolean(),
  ways: z.array(signInWaySchema),
});
export type SignInPage = z.infer<typeof signInPageSchema>;

/** `POST /sign-in/first-user`: the first user's name, email and password. */
export const firstUserSchema = z.object({
  name: z.string(),
  email: z.string(),
  password: z.string(),
});
export type FirstUser = z.infer<typeof firstUserSchema>;

/** `POST /sign-in/password`. */
export const passwordSignInSchema = z.object({
  email: z.string(),
  password: z.string(),
});
export type PasswordSignIn = z.infer<typeof passwordSignInSchema>;

/**
 * How a sign-in ended: signed in, its cookie set, or waiting for the user's authenticator code, a
 * pending sign-in's own cookie set for `POST /sign-in/code`.
 */
export const signInOutcomeSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("signed-in") }),
  z.object({ outcome: z.literal("code-needed") }),
]);
export type SignInOutcome = z.infer<typeof signInOutcomeSchema>;

/**
 * An authenticator code, or a recovery code standing in for one: `POST /sign-in/code` and
 * `DELETE /account/authenticator`.
 */
export const codeAnswerSchema = z.union([
  z.strictObject({ code: z.string() }),
  z.strictObject({ recoveryCode: z.string() }),
]);
export type CodeAnswer = z.infer<typeof codeAnswerSchema>;

/**
 * A refused sign-in: a wrong email, password or code (422), or a try not taken (429) for the slow-down's
 * wait or the lockout, with when to try again. An unknown email is answered as a wrong password.
 */
export const signInRefusalSchema = z.object({
  statusCode: z.union([z.literal(422), z.literal(429)]),
  message: z.string(),
  refusal: z.enum(["wrong", "slow-down", "locked"]),
  tryAgainAt: z.iso.datetime().optional(),
});
export type SignInRefusal = z.infer<typeof signInRefusalSchema>;

/** A refused new user: every reason, also joined into Nest's `message`. */
export const userRefusalSchema = z.object({
  statusCode: z.literal(422),
  message: z.string(),
  reasons: z.array(z.string()).min(1),
});
export type UserRefusal = z.infer<typeof userRefusalSchema>;

/** Whether the user's authenticator is on, and how many unused recovery codes they have left. */
export const authenticatorStateSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("off") }),
  z.object({ state: z.literal("on"), recoveryCodesLeft: z.number().int().nonnegative() }),
]);
export type AuthenticatorState = z.infer<typeof authenticatorStateSchema>;

/** `GET /account`: the signed-in user's own record. */
export const accountSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  authenticator: authenticatorStateSchema,
});
export type Account = z.infer<typeof accountSchema>;

/**
 * `POST /account/authenticator`: a new authenticator's `otpauth://` address, for the QR code, and
 * its key, to type in by hand. Sent only while it is set up, never again.
 */
export const authenticatorSetupSchema = z.object({
  keyUri: z.string(),
  secret: z.string(),
});
export type AuthenticatorSetup = z.infer<typeof authenticatorSetupSchema>;

/** `POST /account/authenticator/confirm` and `POST /account/recovery-codes`: a current code. */
export const authenticatorCodeSchema = z.strictObject({ code: z.string() });
export type AuthenticatorCode = z.infer<typeof authenticatorCodeSchema>;

/** A new set of recovery codes, answered once; only their hashes are kept. */
export const recoveryCodesSchema = z.object({
  recoveryCodes: z.array(z.string()).min(1),
});
export type RecoveryCodes = z.infer<typeof recoveryCodesSchema>;

/** A browser the user signed in from, `thisDevice` marking the one asking. Never a session. */
export const signedInDeviceSchema = z.object({
  id: z.string(),
  userAgent: z.string().nullable(),
  addressKind: addressKindSchema,
  signedInAt: z.iso.datetime(),
  lastSeenAt: z.iso.datetime(),
  thisDevice: z.boolean(),
});
export type SignedInDevice = z.infer<typeof signedInDeviceSchema>;

export const signedInDeviceListSchema = z.array(signedInDeviceSchema);
