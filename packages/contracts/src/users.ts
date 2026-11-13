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
 * How a sign-in ended, its cookie set when signed in. A union on `outcome`, which a second step,
 * such as asking for an authenticator code, joins with its Task.
 */
export const signInOutcomeSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("signed-in") }),
]);
export type SignInOutcome = z.infer<typeof signInOutcomeSchema>;

/**
 * A refused sign-in: a wrong email or password (422), or a try not taken (429) for the slow-down's
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

/** `GET /account`: the signed-in user's own record. */
export const accountSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
});
export type Account = z.infer<typeof accountSchema>;

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
