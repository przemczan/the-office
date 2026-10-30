import { countedTokens, type TokenTotals } from "@the-office/contracts";
import { Icon, Tooltip } from "@the-office/ui";
import type { ReactNode } from "react";
import { tokensShort } from "./conversation/context-words.ts";
import { tokenKindLines } from "./token-words.ts";

/**
 * A token count as every place shows it, cache reads left out (`countedTokens`), with the info icon
 * that gives each kind: "45k tokens in this Thread ⓘ".
 */
export function TokenCount({
  tokens,
  label,
  strong = false,
}: {
  readonly tokens: TokenTotals;
  /** What follows the number, such as "tokens today". */
  readonly label: string;
  /** The number in bold, as Now's figures and the strip show theirs. */
  readonly strong?: boolean;
}): ReactNode {
  const count = tokensShort(countedTokens(tokens));
  return (
    <span className="token-count">
      {strong ? <b>{count}</b> : count} {label}
      <TokenInfo tokens={tokens} />
    </span>
  );
}

/** The info icon beside a count, its tooltip giving each kind and what it costs. */
export function TokenInfo({ tokens }: { readonly tokens: TokenTotals }): ReactNode {
  const lines = tokenKindLines(tokens);
  return (
    <Tooltip
      content={
        <span className="token-kinds">
          {lines.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </span>
      }
    >
      <button type="button" className="token-info" aria-label={lines.join(" ")}>
        <Icon name="info" size={12} />
      </button>
    </Tooltip>
  );
}
