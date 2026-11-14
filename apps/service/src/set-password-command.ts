import {
  UserNotFound,
  UserRefused,
  type Authenticators,
  type Passwords,
} from "./modules/users/index.js";

/** What the command reads and writes: the terminal, or a test's stand-in. */
export interface SetPasswordConsole {
  /** Whether a person types at a terminal; otherwise the password comes from standard input. */
  readonly interactive: boolean;
  /** Asks at the terminal without showing what is typed. */
  askHidden(question: string): Promise<string>;
  /** Standard input's first line, when it isn't a terminal. */
  readPiped(): Promise<string>;
  info(line: string): void;
  error(line: string): void;
}

const USAGE = "Usage: npm run set-password -- --email <email> [--clear-authenticator]";
const CLEAR_AUTHENTICATOR = "--clear-authenticator";

/** What the command changes: the user's password, and their authenticator when asked. */
export interface SetPasswordServices {
  readonly passwords: Pick<Passwords, "userWith" | "set">;
  readonly authenticators: Pick<Authenticators, "remove">;
}

/**
 * `npm run set-password -- --email <email>` (spec §2.10, "Recovery"): asks for a new password
 * twice, or reads it from standard input, then sets it, lifts the user's lockout of their password
 * and codes and signs out all their signed-in devices; with `--clear-authenticator` it also removes
 * their authenticator and recovery codes. Answers the process's exit code.
 */
export async function setPasswordCommand(
  args: readonly string[],
  terminal: SetPasswordConsole,
  { passwords, authenticators }: SetPasswordServices,
): Promise<number> {
  const email = emailOf(args);
  if (email === undefined) {
    terminal.error(USAGE);
    return 2;
  }
  const clearAuthenticator = args.includes(CLEAR_AUTHENTICATOR);
  try {
    const user = await passwords.userWith(email);
    const password = await newPassword(terminal);
    if (password === undefined) {
      terminal.error("The two passwords differ; nothing was changed.");
      return 1;
    }
    await passwords.set(email, password);
    if (clearAuthenticator) await authenticators.remove(user.id);
  } catch (error) {
    if (error instanceof UserNotFound) terminal.error(error.message);
    else if (error instanceof UserRefused) terminal.error(error.reasons.join("\n"));
    else throw error;
    return 1;
  }
  terminal.info(
    `${email} has a new password: their lockout is lifted and every device they signed in from is signed out.`,
  );
  if (clearAuthenticator) {
    terminal.info("Their authenticator and recovery codes are removed.");
  }
  return 0;
}

function emailOf(args: readonly string[]): string | undefined {
  const index = args.findIndex((arg) => arg === "--email" || arg.startsWith("--email="));
  const arg = args[index];
  if (arg === undefined) return undefined;
  const email = arg === "--email" ? args[index + 1] : arg.slice("--email=".length);
  return email === undefined || email.trim() === "" ? undefined : email.trim();
}

/** The new password; undefined when the two typed differ. */
async function newPassword(terminal: SetPasswordConsole): Promise<string | undefined> {
  if (!terminal.interactive) return terminal.readPiped();
  const password = await terminal.askHidden("New password: ");
  const again = await terminal.askHidden("The new password again: ");
  return password === again ? password : undefined;
}
