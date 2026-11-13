import { NO_WRONG_TRIES, type WrongTries } from "./wrong-tries.js";

/** Someone who signs in to The Office (spec §2.10). Emails are unique, compared without case. */
export interface User {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  /** The password's scrypt hash with its salt and parameters; never the password. */
  readonly passwordHash: string;
  readonly wrongTries: WrongTries;
  readonly createdAt: Date;
}

/** What a user is made of before their password is hashed. */
export interface NewUser {
  readonly name: string;
  readonly email: string;
  readonly password: string;
}

const NAME_MAX = 100;
const EMAIL_MAX = 254;
const PASSWORD_MIN = 12;
const PASSWORD_MAX = 256;
// One @ with something on each side and a dot in the domain; the rest is the user's to get right.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Every problem with a new user, in the UI's words; none when it can be made. */
export function newUserProblems({ name, email, password }: NewUser): readonly string[] {
  const problems: string[] = [];
  if (name.trim() === "") problems.push("Give a name.");
  else if (name.trim().length > NAME_MAX)
    problems.push(`A name has at most ${NAME_MAX} characters.`);
  if (!EMAIL_SHAPE.test(email.trim()) || email.trim().length > EMAIL_MAX) {
    problems.push("Give an email such as ada@example.com.");
  }
  problems.push(...passwordProblems(password, email));
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
export function userOf(
  id: string,
  { name, email }: NewUser,
  passwordHash: string,
  createdAt: Date,
): User {
  return {
    id,
    name: name.trim(),
    email: keptEmail(email),
    passwordHash,
    wrongTries: NO_WRONG_TRIES,
    createdAt,
  };
}

/** The user with a new password: their wrong tries and lockout lifted. */
export function withPassword(user: User, passwordHash: string): User {
  return { ...user, passwordHash, wrongTries: NO_WRONG_TRIES };
}
