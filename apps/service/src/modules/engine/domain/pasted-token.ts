import { inspect } from "node:util";

/** What `claude setup-token` makes: a year-long sign-in token of a Claude account. */
const PASTED_TOKEN_SHAPE = /^sk-ant-oat01-[\w-]+$/;

/** What a pasted token reads as wherever it is printed, logged or serialised. */
const REDACTED = "[a pasted token]";

/** The text pasted is no token `claude setup-token` makes. */
export class NotAPastedToken extends Error {
  constructor() {
    super("That is no token from `claude setup-token`: one starts with sk-ant-oat01-.");
  }
}

/**
 * A token the user pasted for a Claude Code engine (spec §5.4, "Paste a token instead"). It signs
 * the engine in and is never sent back, so it reads as redacted everywhere but `reveal`, which only
 * the adapter writing it into the engine's folder calls.
 */
export class PastedToken {
  readonly #token: string;

  private constructor(token: string) {
    this.#token = token;
  }

  /** The token pasted as `text`, trimmed; `NotAPastedToken` when it has not the shape of one. */
  static of(text: string): PastedToken {
    const token = text.trim();
    if (!PASTED_TOKEN_SHAPE.test(token)) throw new NotAPastedToken();
    return new PastedToken(token);
  }

  reveal(): string {
    return this.#token;
  }

  toString(): string {
    return REDACTED;
  }

  toJSON(): string {
    return REDACTED;
  }

  [inspect.custom](): string {
    return REDACTED;
  }
}
