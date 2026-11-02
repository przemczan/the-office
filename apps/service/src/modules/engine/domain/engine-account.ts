import { z } from "zod";

/**
 * A Claude Code engine's account, as `claude auth status` gives it (spec §5.4), signed in by Sign
 * in or by a pasted token, which tells no email or plan.
 */
export type EngineAccount =
  | { readonly signedIn: false }
  | {
      readonly signedIn: true;
      readonly pastedToken: boolean;
      readonly email: string | undefined;
      /** The Claude subscription, such as `max` or `pro`. */
      readonly plan: string | undefined;
    };

/** The account's status could not be read: the binary gave no status, in words. */
export class EngineAccountUnreadable extends Error {}

/*
 * `auth status --json` exits 1 when signed out yet still prints its status, so only the output
 * counts. Fields beyond `loggedIn` are read only when they are text: the signed-in names come from
 * the binary's help, not from a signed-in run.
 */
const authStatusSchema = z.object({
  loggedIn: z.boolean(),
  email: z.unknown().optional(),
  subscriptionType: z.unknown().optional(),
});

/**
 * The account `auth status --json` printed as `output`. With `pastedToken`, what the folder holds
 * is a pasted token, and any email or plan told is an earlier Sign in's, left in the folder.
 */
export function engineAccountOf(output: string, pastedToken: boolean): EngineAccount {
  const status = authStatusSchema.safeParse(parsedJson(output.trim()));
  if (!status.success) {
    const said = output.trim().split(/\r?\n/, 1)[0] ?? "";
    throw new EngineAccountUnreadable(
      `Claude Code gave no account status${said === "" ? "." : `: ${said}`}`,
    );
  }
  const { loggedIn, email, subscriptionType } = status.data;
  if (!loggedIn) return { signedIn: false };
  if (pastedToken) return { signedIn: true, pastedToken, email: undefined, plan: undefined };
  return {
    signedIn: true,
    pastedToken,
    email: textOrUndefined(email),
    plan: textOrUndefined(subscriptionType),
  };
}

function parsedJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function textOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}
