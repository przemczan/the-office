import { inspect } from "node:util";

/** What a Gemini API key reads as wherever it is printed, logged or serialised. */
const REDACTED = "[an API key]";

/** The text given is no API key: it is empty. */
export class NotAGeminiApiKey extends Error {
  constructor() {
    super("That is no API key: paste the Gemini API key from Google AI Studio itself.");
  }
}

/**
 * The Gemini API key from Google AI Studio that signs a Gemini CLI engine in (spec §5.4.7). It is
 * kept in the database and never sent back, so it reads as redacted everywhere but `reveal`, which
 * only the repository keeping it and the adapter giving it to the CLI's environment call.
 */
export class GeminiApiKey {
  readonly #key: string;

  private constructor(key: string) {
    this.#key = key;
  }

  /** The key given as `text`, trimmed; `NotAGeminiApiKey` when nothing is left. */
  static of(text: string): GeminiApiKey {
    const key = text.trim();
    if (key === "") throw new NotAGeminiApiKey();
    return new GeminiApiKey(key);
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
