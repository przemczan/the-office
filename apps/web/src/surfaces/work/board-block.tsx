import { Link } from "@tanstack/react-router";
import type { Initiative, TaskSummary } from "@the-office/contracts";
import { Button, Icon, PlainMark } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { blockCount } from "./board-blocks.ts";
import type { Column } from "./board-columns.ts";
import { InitiativePausedBadge } from "./initiative-pause.tsx";

export interface InitiativeBlockProps {
  readonly initiative: Pick<Initiative, "id" | "name" | "pausedAt">;
  readonly column: Column;
  /** The block's cards the column shows, in its order. */
  readonly cards: readonly TaskSummary[];
  /** Its Initiative's head is hovered or focused, in this column or another. */
  readonly outlined: boolean;
  /** A card of this block is dragged: where it can land. */
  readonly landing: boolean;
  /** The head was hovered or focused (the Initiative's id), or left (undefined). */
  readonly onOutline: (initiativeId: string | undefined) => void;
  /** Draws one of the cards, as the board does. */
  readonly renderCard: (card: TaskSummary) => ReactNode;
}

/**
 * An Initiative's cards in one column (docs/design/board-initiative-blocks.html): a group named by
 * the Initiative, never a region or a heading, so the column stays the board's region and its `h3`
 * the only heading.
 */
export function InitiativeBlock({
  initiative,
  column,
  cards,
  outlined,
  landing,
  onOutline,
  renderCard,
}: InitiativeBlockProps): ReactNode {
  const [unfolded, setUnfolded] = useState(false);
  const count = blockCount(cards, column);
  const foldable = column.key === "done" && cards.length > 1;
  const shown = foldable && !unfolded ? cards.slice(0, 1) : cards;
  const classes = ["initiative-block", outlined && "outlined", landing && "drop-ok"]
    .filter(Boolean)
    .join(" ");
  return (
    <div
      className={classes}
      role="group"
      aria-label={initiative.name}
      data-initiative-block={initiative.id}
    >
      <div
        className="initiative-block-head"
        onMouseEnter={() => onOutline(initiative.id)}
        onMouseLeave={() => onOutline(undefined)}
        onFocus={() => onOutline(initiative.id)}
        onBlur={() => onOutline(undefined)}
      >
        <Link
          to="/work/initiatives/$initiativeId"
          params={{ initiativeId: initiative.id }}
          className="initiative-block-name"
          draggable={false}
        >
          <Icon name="flag" size={12} />
          <span>{initiative.name}</span>
        </Link>
        <InitiativePausedBadge initiative={initiative} size="sm" />
        <PlainMark words={count.words} className="initiative-block-count">
          {count.shown}
        </PlainMark>
      </div>
      <div className="initiative-block-cards">{shown.map(renderCard)}</div>
      {foldable && (
        <Button
          variant="ghost"
          size="sm"
          fullWidth
          iconLeft={<Icon name={unfolded ? "chevron-up" : "chevron-down"} size={14} />}
          aria-expanded={unfolded}
          onClick={() => setUnfolded(!unfolded)}
        >
          {unfolded ? "Show fewer" : `Show ${cards.length - 1} more`}
        </Button>
      )}
    </div>
  );
}
