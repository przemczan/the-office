import { z } from "zod";
import { webEventSchema } from "./events.js";

/**
 * The kind of address a page was opened at (spec §2.10), which decides the ways to sign in it
 * offers.
 */
export const addressKindSchema = z.enum(["localhost", "loopback-ip", "local-network-ip", "public"]);
export type AddressKind = z.infer<typeof addressKindSchema>;

/**
 * A way to sign in the sign-in page offers. A union by `kind`, which Continue with GitHub and
 * Continue with Google join as their Tasks add them.
 */
export const signInWaySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("password") }),
  z.object({ kind: z.literal("passkey") }),
]);
export type SignInWay = z.infer<typeof signInWaySchema>;
export type SignInWayKind = SignInWay["kind"];

/**
 * Why a way doesn't work at the page's address: it is an IP address (`127.0.0.1`, which a passkey
 * can't be kept for), or it isn't a domain name over HTTPS.
 */
export const wayUnavailableReasonSchema = z.enum(["ip-address", "needs-https-domain"]);
export type WayUnavailableReason = z.infer<typeof wayUnavailableReasonSchema>;

/** A way set up that doesn't work here, why, and the address it works at instead, when one does. */
export const unavailableWaySchema = z.object({
  kind: z.enum(["password", "passkey"]) satisfies z.ZodType<SignInWayKind>,
  reason: wayUnavailableReasonSchema,
  elsewhere: z.string().optional(),
});
export type UnavailableWay = z.infer<typeof unavailableWaySchema>;

/**
 * `GET /sign-in`: whether The Office waits for its first user, whose form the page then shows,
 * the ways that work at the address the page was opened at, and those that don't, with why.
 */
export const signInPageSchema = z.object({
  firstRun: z.boolean(),
  ways: z.array(signInWaySchema),
  unavailable: z.array(unavailableWaySchema),
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
  /** A right one-time password: the user sets their own password next, still signed out. */
  z.object({ outcome: z.literal("set-password") }),
]);
export type SignInOutcome = z.infer<typeof signInOutcomeSchema>;

/**
 * `POST /sign-in/set-password`: a user added by another sets their own password at their first
 * sign-in, with their one-time password again.
 */
export const firstPasswordSchema = z.object({
  email: z.string(),
  oneTimePassword: z.string(),
  password: z.string(),
});
export type FirstPassword = z.infer<typeof firstPasswordSchema>;

/**
 * A refused sign-in: a wrong email or password (422), a right one-time password past its days
 * (422), a passkey that signed nobody in (422, one answer for every reason), or a try not taken
 * (429) for the slow-down's wait or the lockout, with when to try again. An unknown email is
 * answered as a wrong password.
 */
export const signInRefusalSchema = z.object({
  statusCode: z.union([z.literal(422), z.literal(429)]),
  message: z.string(),
  refusal: z.enum(["wrong", "slow-down", "locked", "expired", "passkey"]),
  tryAgainAt: z.iso.datetime().optional(),
});
export type SignInRefusal = z.infer<typeof signInRefusalSchema>;

/** A refused change to a user, a new one or a removal: every reason, also joined into Nest's `message`. */
export const userRefusalSchema = z.object({
  statusCode: z.literal(422),
  message: z.string(),
  reasons: z.array(z.string()).min(1),
});
export type UserRefusal = z.infer<typeof userRefusalSchema>;

/**
 * The palettes' and densities' ids (spec §4). `packages/ui` names each in `PALETTES` and
 * `DENSITIES`, which a web test holds equal to these.
 */
export const PALETTE_IDS = [
  "light",
  "dark",
  "graphite",
  "paper",
  "midnight",
  "mist",
  "mocha",
  "sage",
  "aubergine",
  "lavender",
  "lagoon",
  "cobalt",
  "emerald",
  "citrine",
] as const;
export const DENSITY_IDS = ["compact", "comfortable", "relaxed"] as const;

/**
 * A user's own palette and density, kept with their account (`PUT /account/appearance`); null
 * palette follows the system, null density is Comfortable.
 */
export const appearanceSchema = z.object({
  palette: z.enum(PALETTE_IDS).nullable(),
  density: z.enum(DENSITY_IDS).nullable(),
});
export type Appearance = z.infer<typeof appearanceSchema>;

/** `GET /account`: the signed-in user's own record. */
export const accountSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  appearance: appearanceSchema,
});
export type Account = z.infer<typeof accountSchema>;

/** `PATCH /account`: a new name, email or both. */
export const profileChangeSchema = z
  .object({ name: z.string(), email: z.string() })
  .partial()
  .refine((change) => change.name !== undefined || change.email !== undefined, {
    message: "Give a name or an email.",
  });
export type ProfileChange = z.infer<typeof profileChangeSchema>;

/** `POST /account/password`: the current password and the new one. */
export const passwordChangeSchema = z.object({
  currentPassword: z.string(),
  newPassword: z.string(),
});
export type PasswordChange = z.infer<typeof passwordChangeSchema>;

/**
 * A user as Settings › Users lists them (`GET /users`): `you` marks the signed-in user, and
 * `oneTimePasswordExpiresAt` is set while they haven't set their own password at a first sign-in.
 */
export const userSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  you: z.boolean(),
  oneTimePasswordExpiresAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type User = z.infer<typeof userSchema>;

export const userListSchema = z.array(userSchema);

/** `POST /users`: the new user's name and email. */
export const newUserSchema = z.object({ name: z.string(), email: z.string() });
export type NewUser = z.infer<typeof newUserSchema>;

/**
 * A one-time password, answered once, when a user is added (`POST /users`) or made anew
 * (`POST /users/:userId/one-time-password`), and never again.
 */
export const oneTimePasswordSchema = z.object({ oneTimePassword: z.string() });
export type OneTimePassword = z.infer<typeof oneTimePasswordSchema>;

export const addedUserSchema = z.object({ user: userSchema, oneTimePassword: z.string() });
export type AddedUser = z.infer<typeof addedUserSchema>;

/** The users' events the web receives, each naming the user, so Settings › Users and the account refresh. */
export const userWebEventSchema = z.discriminatedUnion("type", [
  webEventSchema.extend({ type: z.literal("user.created"), userId: z.string() }),
  webEventSchema.extend({ type: z.literal("user.changed"), userId: z.string() }),
  webEventSchema.extend({ type: z.literal("user.removed"), userId: z.string() }),
]);
export type UserWebEvent = z.infer<typeof userWebEventSchema>;

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
