import { Card, Icon } from "@the-office/ui";
import { useId, type ReactNode } from "react";
import type { Fold } from "./record-folds.ts";

const FOLDED_BODY = { display: "none" } as const;

/**
 * A block of a record that folds to one line, its summary. Its side stays reachable either way. A
 * folded body stays mounted, so an editor folded away keeps what was typed.
 */
export function RecordFold({
  fold,
  icon,
  title,
  summary,
  side,
  children,
}: {
  readonly fold: Fold;
  readonly icon: string;
  readonly title: string;
  readonly summary: string;
  readonly side?: ReactNode;
  readonly children: ReactNode;
}): ReactNode {
  const bodyId = useId();
  return (
    <section aria-label={title}>
      <Card
        title={
          <button
            type="button"
            className="record-fold-head"
            aria-expanded={fold.isOpen}
            aria-controls={bodyId}
            onClick={fold.toggle}
          >
            <Icon name="chevron-right" size={14} />
            <span className="task-block-title">
              <Icon name={icon} size={15} strokeWidth={1.6} />
              {title}
            </span>
            <span className="record-fold-summary">{summary}</span>
          </button>
        }
        actions={side}
        bodyStyle={fold.isOpen ? undefined : FOLDED_BODY}
      >
        <div id={bodyId}>{children}</div>
      </Card>
    </section>
  );
}
