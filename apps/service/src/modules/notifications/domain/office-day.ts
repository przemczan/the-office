/** Tokens split as the engine reports them. */
export interface TokenKinds {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheCreation: number;
}

export const NO_TOKENS: TokenKinds = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };

export function addTokenKinds(one: TokenKinds, other: TokenKinds): TokenKinds {
  return {
    input: one.input + other.input,
    output: one.output + other.output,
    cacheRead: one.cacheRead + other.cacheRead,
    cacheCreation: one.cacheCreation + other.cacheCreation,
  };
}

/** What each kind grew by from `before` to `after`; a kind shrinks when a turn's own count lands. */
export function tokensGrown(before: TokenKinds, after: TokenKinds): TokenKinds {
  return {
    input: after.input - before.input,
    output: after.output - before.output,
    cacheRead: after.cacheRead - before.cacheRead,
    cacheCreation: after.cacheCreation - before.cacheCreation,
  };
}
