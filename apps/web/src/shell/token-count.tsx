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

/** Just the number, where what is around it says what it counts; hovering it gives each kind. */
export function TokenFigure({ tokens }: { readonly tokens: TokenTotals }): ReactNode {
  const lines = tokenKindLines(tokens);
  return (
    <Tooltip content={<TokenKinds lines={lines} />}>
      <button type="button" className="token-figure" aria-label={lines.join(" ")}>
        {tokensShort(countedTokens(tokens))}
      </button>
    </Tooltip>
  );
}

/** The tokens used against the Planner's estimate: "45k of ~120k tokens ⓘ" beside a small bar. */
export function TokenMeter({
  tokens,
  estimatedTokens,
}: {
  readonly tokens: TokenTotals;
  readonly estimatedTokens: number;
}): ReactNode {
  const used = countedTokens(tokens);
  return (
    <span className="token-meter" title="Tokens used of the Planner's estimate">
      <span
        className="token-meter-bar"
        role="progressbar"
        aria-label="Tokens used of the Planner's estimate"
        aria-valuenow={Math.min(used, estimatedTokens)}
        aria-valuemax={estimatedTokens}
      >
        <i style={{ width: `${Math.min(100, (used * 100) / Math.max(estimatedTokens, 1))}%` }} />
      </span>
      <span className="token-count">
        {tokensShort(used)} of ~{tokensShort(estimatedTokens)} tokens
        <TokenInfo tokens={tokens} />
      </span>
    </span>
  );
}

/** The info icon beside a count, its tooltip giving each kind and what it costs. */
function TokenInfo({ tokens }: { readonly tokens: TokenTotals }): ReactNode {
  const lines = tokenKindLines(tokens);
  return (
    <Tooltip content={<TokenKinds lines={lines} />}>
      <button type="button" className="token-info" aria-label={lines.join(" ")}>
        <Icon name="info" size={12} />
      </button>
    </Tooltip>
  );
}

function TokenKinds({ lines }: { readonly lines: readonly string[] }): ReactNode {
  return (
    <span className="token-kinds">
      {lines.map((line) => (
        <span key={line}>{line}</span>
      ))}
    </span>
  );
}
