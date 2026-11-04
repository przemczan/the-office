import { Icon } from "@the-office/ui";
import { useId, type ReactNode } from "react";
import type { Fold } from "./record-folds.ts";

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
    <section className="record-fold" aria-label={title}>
      <div className="record-fold-row">
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
        {side !== undefined && <div className="record-fold-side">{side}</div>}
      </div>
      <div id={bodyId} className="record-fold-body" hidden={!fold.isOpen}>
        {children}
      </div>
    </section>
  );
}
