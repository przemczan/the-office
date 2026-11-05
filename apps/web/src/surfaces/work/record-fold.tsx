import { FoldButton, Icon } from "@the-office/ui";
import { useId, type ReactNode } from "react";
import type { Fold } from "./record-folds.ts";

/**
 * A block of a record that folds to one line, its summary. Its side stays reachable either way. A
 * folded body stays mounted, so an editor folded away keeps what was typed.
 */
export function RecordFold({
  id,
  fold,
  icon,
  title,
  summary,
  side,
  children,
}: {
  /** The element's id, for a link that leads to the block. */
  readonly id?: string;
  readonly fold: Fold;
  readonly icon: string;
  readonly title: string;
  readonly summary: string;
  readonly side?: ReactNode;
  readonly children: ReactNode;
}): ReactNode {
  const bodyId = useId();
  return (
    <section id={id} className="record-fold" aria-label={title}>
      <div className="record-fold-row">
        <FoldButton
          className="record-fold-head"
          unfolded={fold.isOpen}
          aria-controls={bodyId}
          onClick={fold.toggle}
        >
          <span className="task-block-title">
            <Icon name={icon} size={15} strokeWidth={1.6} />
            {title}
          </span>
          <span className="record-fold-summary">{summary}</span>
        </FoldButton>
        {side !== undefined && <div className="record-fold-side">{side}</div>}
      </div>
      <div id={bodyId} className="record-fold-body" hidden={!fold.isOpen}>
        {children}
      </div>
    </section>
  );
}
