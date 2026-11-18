import { inspect } from "node:util";

/** What the Claude Console makes: an Anthropic API key. */
const ANTHROPIC_API_KEY_SHAPE = /^sk-ant-api\d\d-[\w-]+$/;

/** What an Anthropic API key reads as wherever it is printed, logged or serialised. */
const REDACTED = "[an API key]";

/** The text given is no Anthropic API key. */
export class NotAnAnthropicApiKey extends Error {
  constructor() {
    super("That is no Anthropic API key: one starts with sk-ant-api.");
  }
}

/**
 * An Anthropic API key the user gave a Claude Code engine (spec §5.4, "Use an API key"). It signs
 * the engine in and is never sent back, so it reads as redacted everywhere but `reveal`, which only
 * the adapter writing it into the engine's folder calls.
 */
export class AnthropicApiKey {
  readonly #key: string;

  private constructor(key: string) {
    this.#key = key;
  }

  /** The key given as `text`, trimmed; `NotAnAnthropicApiKey` when it has not the shape of one. */
  static of(text: string): AnthropicApiKey {
    const key = text.trim();
    if (!ANTHROPIC_API_KEY_SHAPE.test(key)) throw new NotAnAnthropicApiKey();
    return new AnthropicApiKey(key);
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
