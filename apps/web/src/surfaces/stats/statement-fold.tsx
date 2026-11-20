import { Button, Icon } from "@the-office/ui";
import type { ReactNode } from "react";
import { useCopyText } from "../../shell/copy-text.ts";
import {
  CALLED_FROM,
  CALLED_FROM_NONE,
  COPY_SHAPE,
  SHAPE_COPIED,
  SHAPE_NOT_COPIED,
} from "./system-health-words.ts";

/**
 * What a slowest query's row unfolds to on 1 h (spec 2.11, System health 8): Copy, which copies
 * its whole statement shape, and the places in The Office's code it was run from, each a file
 * path from the repository's root with its line and function.
 */
export function StatementFold({
  shape,
  calledFrom,
}: {
  readonly shape: string;
  readonly calledFrom: readonly string[];
}): ReactNode {
  const copyText = useCopyText();
  return (
    <div className="stats-statement">
      <Button
        size="sm"
        variant="secondary"
        iconLeft={<Icon name="copy" size={14} />}
        onClick={() => copyText(shape, { copied: SHAPE_COPIED, notCopied: SHAPE_NOT_COPIED })}
      >
        {COPY_SHAPE}
      </Button>
      {calledFrom.length === 0 ? (
        <p className="stats-statement-none">{CALLED_FROM_NONE}</p>
      ) : (
        <div className="stats-statement-from">
          <span className="stats-sub-title">{CALLED_FROM}</span>
          <ul>
            {calledFrom.map((site) => (
              <li key={site}>
                <code>{site}</code>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
