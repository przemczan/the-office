import { FirstUserExists, type FirstRunSetup } from "./modules/users/index.js";

/** What the command writes to: the terminal, or a test's stand-in. */
export interface SetupTokenConsole {
  info(line: string): void;
  error(line: string): void;
}

/** What the command needs: First-run setup, and where to open The Office when it is known. */
export interface SetupTokenServices {
  readonly firstRunSetup: Pick<FirstRunSetup, "newToken">;
  readonly addressToOpen: string | undefined;
}

const USAGE = "Usage: npm run setup-token [-- --quiet]";
const QUIET = "--quiet";

/**
 * `npm run setup-token` (spec §2.10, "First-run setup"): prints a new setup token, which ends any
 * earlier one, and where to open The Office to create the first user with it; `--quiet` prints the
 * token alone, for an installer to read. Once a user exists it makes none and exits with 1, pointing
 * to `npm run set-password`; 2 for arguments it doesn't take. Answers the process's exit code.
 */
export async function setupTokenCommand(
  args: readonly string[],
  terminal: SetupTokenConsole,
  { firstRunSetup, addressToOpen }: SetupTokenServices,
): Promise<number> {
  if (args.some((arg) => arg !== QUIET)) {
    terminal.error(USAGE);
    return 2;
  }
  let token: string;
  try {
    token = await firstRunSetup.newToken();
  } catch (error) {
    if (!(error instanceof FirstUserExists)) throw error;
    terminal.error(
      "The Office already has its first user, so it takes no setup token. To set a user's password, run `npm run set-password -- --email <email>`.",
    );
    return 1;
  }
  if (args.includes(QUIET)) {
    terminal.info(token);
    return 0;
  }
  terminal.info(`Setup token: ${token}`);
  terminal.info(
    addressToOpen === undefined
      ? "Open The Office and give it this token to create the first user."
      : `Open ${addressToOpen} and give it this token to create the first user.`,
  );
  terminal.info("Any earlier setup token no longer works.");
  return 0;
}
