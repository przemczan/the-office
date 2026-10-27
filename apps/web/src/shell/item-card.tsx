import type { ReactNode } from "react";

/**
 * What colours a card's left edge: the item's type or its status (spec §4, a deliberate deviation
 * from the design system's plain cards).
 */
export type CardEdge = "decision" | "gate" | "message" | "running" | "done" | "failed" | "paused";

export function ItemCard({
  edge,
  label,
  children,
}: {
  readonly edge: CardEdge;
  /** What the card is, for assistive technology, such as "Running: Add a filter". */
  readonly label?: string;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <article className={`item-card edge-${edge}`} aria-label={label}>
      {children}
    </article>
  );
}

/** What a panel shows when it has no items. */
export function EmptyCard({ children }: { readonly children: ReactNode }): ReactNode {
  return <div className="empty-card">{children}</div>;
}
