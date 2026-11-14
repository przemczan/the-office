import type { TokenTotals } from "@the-office/contracts";
import { tokensShort } from "./conversation/context-words.ts";

export const NO_TOKENS: TokenTotals = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };

export function sumTokens(totals: readonly TokenTotals[]): TokenTotals {
  return totals.reduce(
    (sum, tokens) => ({
      input: sum.input + tokens.input,
      output: sum.output + tokens.output,
      cacheRead: sum.cacheRead + tokens.cacheRead,
      cacheCreation: sum.cacheCreation + tokens.cacheCreation,
    }),
    NO_TOKENS,
  );
}

/**
 * What a token count holds, kind by kind, and what each costs against input's price, for its info
 * icon. The ratios are the engine's prices for every Claude model.
 */
export function tokenKindLines(tokens: TokenTotals): string[] {
  return [
    `Input ${tokensShort(tokens.input)}: read fresh, at the input price.`,
    `Output ${tokensShort(tokens.output)}: written by the model, about 5× input.`,
    `Cache writes ${tokensShort(tokens.cacheCreation)}: kept for the next turns, about 1.25× input.`,
    `Cache reads ${tokensShort(tokens.cacheRead)}: reused from the cache, about a tenth of input; left out of the count.`,
  ];
}
