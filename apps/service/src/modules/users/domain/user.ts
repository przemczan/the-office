import { NO_WRONG_TRIES, type WrongTries } from "./wrong-tries.js";

/** Someone who signs in to The Office (spec §2.10). Emails are unique, compared without case. */
export interface User {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  /** The password's scrypt hash with its salt and parameters; never the password. None once removed. */
  readonly passwordHash: string | undefined;
  /**
   * Set while the password is a one-time password (spec §2.10 Defaults): it works until then, for
   * one sign-in that goes straight to setting the user's own password.
   */
  readonly oneTimePasswordExpiresAt: Date | undefined;
  readonly wrongTries: WrongTries;
  readonly appearance: Appearance;
  readonly createdAt: Date;
  /** Set once removed: the user stays, without a password, so what they did keeps their name. */
  readonly removedAt: Date | undefined;
}

/** The user's own palette and density (spec §4), by their ids; none for the defaults. */
export interface Appearance {
  /** None follows the system. */
  readonly palette: string | undefined;
  /** None is Comfortable. */
  readonly density: string | undefined;
}

export const DEFAULT_APPEARANCE: Appearance = { palette: undefined, density: undefined };

/** A user's name and email, as their account shows them. */
export interface Profile {
  readonly name: string;
  readonly email: string;
}

/** What a user is made of before their password is hashed. */
export interface NewUser extends Profile {
  readonly password: string;
}

const NAME_MAX = 100;
const EMAIL_MAX = 254;
const PASSWORD_MIN = 12;
const PASSWORD_MAX = 256;
// One @ with something on each side and a dot in the domain; the rest is the user's to get right.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ONE_TIME_PASSWORD_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Every problem with a new user, in the UI's words; none when it can be made. */
export function newUserProblems(newUser: NewUser): readonly string[] {
  return [...profileProblems(newUser), ...passwordProblems(newUser.password, newUser.email)];
}

/** Every problem with a name and an email, in the UI's words. */
export function profileProblems({ name, email }: Profile): readonly string[] {
  const problems: string[] = [];
  if (name.trim() === "") problems.push("Give a name.");
  else if (name.trim().length > NAME_MAX)
    problems.push(`A name has at most ${NAME_MAX} characters.`);
  if (!EMAIL_SHAPE.test(email.trim()) || email.trim().length > EMAIL_MAX) {
    problems.push("Give an email such as ada@example.com.");
  }
  return problems;
}

/**
 * Every problem with a password (spec §2.10 Defaults, "Password rules"): from 12 to 256
 * characters, any characters, and not the user's email.
 */
export function passwordProblems(password: string, email: string): readonly string[] {
  const length = [...password].length;
  if (length < PASSWORD_MIN) return [`A password has at least ${PASSWORD_MIN} characters.`];
  if (length > PASSWORD_MAX) return [`A password has at most ${PASSWORD_MAX} characters.`];
  if (sameEmail(password, email)) return ["A password can't be the email."];
  return [];
}

/** An email as it is kept: as given, without the spaces around it. */
export function keptEmail(email: string): string {
  return email.trim();
}

/** Whether two emails are the same user's: compared without case. */
export function sameEmail(one: string, other: string): boolean {
  return one.trim().toLowerCase() === other.trim().toLowerCase();
}

/** A user as made, before anything went wrong. */
export function userOf(id: string, profile: Profile, passwordHash: string, createdAt: Date): User {
  return {
    id,
    ...keptProfile(profile),
    passwordHash,
    oneTimePasswordExpiresAt: undefined,
    wrongTries: NO_WRONG_TRIES,
    appearance: DEFAULT_APPEARANCE,
    createdAt,
    removedAt: undefined,
  };
}

/** A user added by another, whose password is a one-time password until they set their own. */
export function addedUserOf(
  id: string,
  profile: Profile,
  oneTimePasswordHash: string,
  createdAt: Date,
): User {
  return withOneTimePassword(
    userOf(id, profile, oneTimePasswordHash, createdAt),
    oneTimePasswordHash,
    createdAt,
  );
}

/** The user with their own password: their one-time password, wrong tries and lockout gone. */
export function withPassword(user: User, passwordHash: string): User {
  return { ...user, passwordHash, oneTimePasswordExpiresAt: undefined, wrongTries: NO_WRONG_TRIES };
}

/** The user with a new one-time password, which ends the one before it and lifts the lockout. */
export function withOneTimePassword(user: User, oneTimePasswordHash: string, now: Date): User {
  return {
    ...user,
    passwordHash: oneTimePasswordHash,
    oneTimePasswordExpiresAt: new Date(now.getTime() + ONE_TIME_PASSWORD_DAYS * DAY_MS),
    wrongTries: NO_WRONG_TRIES,
  };
}

/** Whether the user still waits to set their own password, their one-time password expired or not. */
export function isWaitingForFirstSignIn(user: User): boolean {
  return user.oneTimePasswordExpiresAt !== undefined;
}

export function isOneTimePasswordExpired(user: User, now: Date): boolean {
  return user.oneTimePasswordExpiresAt !== undefined && user.oneTimePasswordExpiresAt <= now;
}

/** The user with a new name and email; undefined when neither changes. */
export function withProfile(user: User, profile: Profile): User | undefined {
  const kept = keptProfile(profile);
  if (kept.name === user.name && kept.email === user.email) return undefined;
  return { ...user, ...kept };
}

/** The user with a new appearance; undefined when it doesn't change. */
export function withAppearance(user: User, appearance: Appearance): User | undefined {
  const { palette, density } = user.appearance;
  if (palette === appearance.palette && density === appearance.density) return undefined;
  return { ...user, appearance };
}

/**
 * Why `by` can't remove the user (spec §2.10 Defaults, "Removing users"), given the users not
 * removed: no one removes themselves, and the remover must still be one of them, so the last user
 * is never removed, even by two users removing each other at once. None when they can.
 */
export function removalProblems(
  userId: string,
  by: string,
  activeUserIds: readonly string[],
): readonly string[] {
  if (userId === by) return ["You can't remove yourself."];
  if (!activeUserIds.includes(by)) return ["You were removed meanwhile."];
  return [];
}

/** The user removed: no password left to sign in with, the name and email kept for the records. */
export function removed(user: User, removedAt: Date): User {
  return {
    ...user,
    passwordHash: undefined,
    oneTimePasswordExpiresAt: undefined,
    wrongTries: NO_WRONG_TRIES,
    removedAt,
  };
}

function keptProfile({ name, email }: Profile): Profile {
  return { name: name.trim(), email: keptEmail(email) };
}
