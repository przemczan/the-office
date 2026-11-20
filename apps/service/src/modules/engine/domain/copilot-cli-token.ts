import { inspect } from "node:util";

/** What a Copilot CLI token reads as wherever it is printed, logged or serialised. */
const REDACTED = "[a token]";

/** A fine-grained personal access token: GitHub's prefix, then letters, digits and underscores. */
const FINE_GRAINED_TOKEN = /^github_pat_\w+$/;

/** The text given is no fine-grained personal access token. */
export class NotACopilotCliToken extends Error {
  constructor() {
    super(
      'That is no fine-grained personal access token: one starts with github_pat_ and has the "Copilot Requests" permission.',
    );
  }
}

/**
 * A fine-grained personal access token with "Copilot Requests" the user pasted into a Copilot CLI
 * engine (spec §5.4, "Paste a token instead"). It signs the engine in, is kept in the database and
 * is never sent back, so it reads as redacted everywhere but `reveal`, which only the repository
 * keeping it and the adapter handing it to the runtime call.
 */
export class CopilotCliToken {
  readonly #token: string;

  private constructor(token: string) {
    this.#token = token;
  }

  /** The token given as `text`, trimmed; `NotACopilotCliToken` unless it has a fine-grained token's shape. */
  static of(text: string): CopilotCliToken {
    const token = text.trim();
    if (!FINE_GRAINED_TOKEN.test(token)) throw new NotACopilotCliToken();
    return new CopilotCliToken(token);
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
