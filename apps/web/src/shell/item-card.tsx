import type { ReactNode, Ref } from "react";

/**
 * What colours a card's left edge: the item's type or its status (spec §4, a deliberate deviation
 * from the design system's plain cards).
 */
export type CardEdge = "decision" | "gate" | "message" | "running" | "done" | "failed" | "paused";

export function ItemCard({
  edge,
  label,
  className,
  ref,
  children,
}: {
  readonly edge: CardEdge;
  /** What the card is, for assistive technology, such as "Running: Add a filter". */
  readonly label?: string;
  /** The page's own class beside the card's, such as one marking it unseen. */
  readonly className?: string;
  readonly ref?: Ref<HTMLElement>;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <article
      ref={ref}
      className={`item-card edge-${edge}${className ? ` ${className}` : ""}`}
      aria-label={label}
    >
      {children}
    </article>
  );
}

/** What a panel shows when it has no items. */
export function EmptyCard({ children }: { readonly children: ReactNode }): ReactNode {
  return <div className="empty-card">{children}</div>;
}
