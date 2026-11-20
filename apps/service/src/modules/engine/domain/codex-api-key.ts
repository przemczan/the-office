import { inspect } from "node:util";

/** What a Codex API key reads as wherever it is printed, logged or serialised. */
const REDACTED = "[an API key]";

/** The text given is no API key: it is empty. */
export class NotACodexApiKey extends Error {
  constructor() {
    super("That is no API key: paste the OpenAI API key itself.");
  }
}

/**
 * An OpenAI API key the user gave a Codex engine (spec §5.4, "Use an API key instead"). It signs
 * the engine in, is kept in the database and is never sent back, so it reads as redacted everywhere
 * but `reveal`, which only the repository keeping it and the adapter signing the folder in call.
 */
export class CodexApiKey {
  readonly #key: string;

  private constructor(key: string) {
    this.#key = key;
  }

  /** The key given as `text`, trimmed; `NotACodexApiKey` when nothing is left. */
  static of(text: string): CodexApiKey {
    const key = text.trim();
    if (key === "") throw new NotACodexApiKey();
    return new CodexApiKey(key);
  }

  reveal(): string {
    return this.#key;
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
