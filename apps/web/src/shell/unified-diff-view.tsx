import type { ReactNode } from "react";
import { diffLines } from "./unified-diff.ts";
import "./unified-diff.css";

/** A unified diff as git gives it, each line coloured by its kind; nothing for no diff. */
export function UnifiedDiffView({
  diff,
  label,
}: {
  readonly diff: string;
  /** What the diff compares, for whoever can't see the colours. */
  readonly label: string;
}): ReactNode {
  const lines = diffLines(diff);
  if (lines.length === 0) return null;
  return (
    <pre className="unified-diff" aria-label={label}>
      {lines.map((line, index) => (
        // A diff's lines repeat and never move, so their place is their identity.
        <span key={index} className={`unified-diff-${line.kind}`}>
          {line.text}
          {"\n"}
        </span>
      ))}
    </pre>
  );
}
