import type { ReactNode } from "react";
import "./plain-text-file.css";

/**
 * A text file as it is, in monospace with its line numbers. Lines don't wrap, so each number
 * stays beside its line; a long line scrolls sideways.
 */
export function PlainTextFile({ text }: { readonly text: string }): ReactNode {
  const lines = text.replace(/\r?\n$/, "").split(/\r?\n/);
  return (
    <div className="plain-text-file">
      <pre className="plain-text-file-numbers" aria-hidden="true">
        {lines.map((_, index) => index + 1).join("\n")}
      </pre>
      <pre className="plain-text-file-lines">{lines.join("\n")}</pre>
    </div>
  );
}
