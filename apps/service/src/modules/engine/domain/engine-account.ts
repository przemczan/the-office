import { z } from "zod";

/**
 * A Claude Code engine's account, as `claude auth status` gives it, signed in by Sign in or by a
 * pasted token, which tells no email or plan, or by an Anthropic API key, which tells none either;
 * or a Codex engine's, as the app-server's `account/read` gives it, signed in by Sign in with
 * ChatGPT or by an OpenAI API key; or a Copilot CLI engine's, as the runtime's sign-in status gives
 * it, its GitHub login as its email, or signed in by a pasted token; or a Gemini CLI engine's,
 * signed in by its Gemini API key or not at all (spec §5.4).
 */
export type EngineAccount =
  | { readonly signedIn: false }
  | {
      readonly signedIn: true;
      /** A token pasted with "Paste a token instead" signs a Claude Code or Copilot CLI engine in. */
      readonly pastedToken: boolean;
      /**
       * An API key signs the engine in: an Anthropic one given a Claude Code engine with "Use an
       * API key", an OpenAI one given a Codex engine with "Use an API key instead", or a Gemini
       * one, a Gemini CLI engine's only sign-in.
       */
      readonly apiKey: boolean;
      readonly email: string | undefined;
      /** The Claude or ChatGPT subscription, such as `max` or `plus`. */
      readonly plan: string | undefined;
    };

/** An engine signed in by nothing. */
export const SIGNED_OUT_ACCOUNT: EngineAccount = { signedIn: false };

/** An engine signed in by an API key: no email or plan is told. */
export const API_KEY_ACCOUNT: EngineAccount = {
  signedIn: true,
  pastedToken: false,
  apiKey: true,
  email: undefined,
  plan: undefined,
};

/** An engine signed in by a pasted token The Office keeps: no email or plan is told. */
export const PASTED_TOKEN_ACCOUNT: EngineAccount = {
  signedIn: true,
  pastedToken: true,
  apiKey: false,
  email: undefined,
  plan: undefined,
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
  if (pastedToken) {
    return { signedIn: true, pastedToken, apiKey: false, email: undefined, plan: undefined };
  }
  return {
    signedIn: true,
    pastedToken,
    apiKey: false,
    email: textOrUndefined(email),
    plan: textOrUndefined(subscriptionType),
  };
}

/** The account the app-server's `account/read` answered: none, an API key, or a ChatGPT login. */
export type CodexAccountRead = null | {
  readonly type: string;
  readonly email?: string | null;
  readonly planType?: string | null;
};

/**
 * The Codex engine's account as `account/read` gave it: signed out without one, an API key, or a
 * ChatGPT login with its email and plan when told. A kind of login The Office doesn't know signs it
 * in all the same, telling nothing more.
 */
export function codexEngineAccountOf(account: CodexAccountRead): EngineAccount {
  if (account === null) return { signedIn: false };
  if (account.type === "apiKey") return API_KEY_ACCOUNT;
  const chatgpt = account.type === "chatgpt";
  return {
    signedIn: true,
    pastedToken: false,
    apiKey: false,
    email: chatgpt ? textOrUndefined(account.email) : undefined,
    plan: chatgpt ? textOrUndefined(account.planType) : undefined,
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
