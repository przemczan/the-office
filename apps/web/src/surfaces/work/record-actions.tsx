import { Button, Icon, type ButtonProps, type MenuItem } from "@the-office/ui";
import { Fragment, useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";

/**
 * One action on a Task, an Initiative or an Idea, defined once: a button in its row of actions,
 * as long as it fits there, and an item of its More menu always.
 */
export interface RecordAction {
  /** Unique among the record's actions. */
  readonly key: string;
  readonly label: string;
  readonly icon: string;
  readonly variant?: "primary" | "secondary" | "ghost";
  /** What it does, on hover over its button. */
  readonly hint?: string;
  readonly ariaLabel?: string;
  readonly disabled?: boolean;
  readonly pending?: boolean;
  readonly onSelect: () => void;
  /**
   * What the row shows instead of a plain button, such as a link, or a button with its switch;
   * null for an action only the menu lists, as one another action's control already offers.
   */
  readonly control?: ReactNode;
}

/** The action as a button, or as its own control. */
export function RecordActionButton({
  action,
  size,
}: {
  readonly action: RecordAction;
  readonly size?: ButtonProps["size"];
}): ReactNode {
  if (action.control !== undefined) return action.control;
  return (
    <Button
      variant={action.variant ?? "secondary"}
      {...(size && { size })}
      iconLeft={<Icon name={action.icon} size={14} />}
      title={action.hint}
      aria-label={action.ariaLabel}
      disabled={action.disabled}
      loading={action.pending}
      onClick={action.onSelect}
    >
      {action.label}
    </Button>
  );
}

/**
 * The actions as the More menu's first items, a divider between them and the menu's own items; a
 * pending action can't be chosen again.
 */
export function withActionItems(
  actions: readonly RecordAction[],
  menuItems: readonly MenuItem[],
): MenuItem[] {
  const actionItems = actions.map((action) => ({
    icon: <Icon name={action.icon} size={14} />,
    label: action.label,
    disabled: (action.disabled ?? false) || (action.pending ?? false),
    onSelect: action.onSelect,
  }));
  if (actionItems.length === 0) return [...menuItems];
  if (menuItems.length === 0) return actionItems;
  return [...actionItems, { divider: true }, ...menuItems];
}

/**
 * The record's actions on one line, ending with its More menu: those that don't fit are hidden
 * rather than wrapped, the last first, as the menu holds every one of them.
 */
export function RecordActions({
  actions,
  menu,
  size,
  align = "end",
  className,
}: {
  readonly actions: readonly RecordAction[];
  readonly menu?: ReactNode;
  readonly size?: ButtonProps["size"];
  /** Where the buttons gather: at the end, by the menu, as in a head, or at the start. */
  readonly align?: "start" | "end";
  readonly className?: string;
}): ReactNode {
  const row = useRef<HTMLDivElement>(null);
  useOnlyWhatFits(row);
  return (
    <div className={className ? `record-actions ${className}` : "record-actions"}>
      <div ref={row} className={`record-actions-row align-${align}`}>
        {actions.map((action) => (
          <Fragment key={action.key}>
            <RecordActionButton action={action} size={size} />
          </Fragment>
        ))}
      </div>
      {menu}
    </div>
  );
}

/**
 * Keeps the row to its first line, as its items wrap: each item past it, or wider than the row,
 * is hidden and inert, and measured again on every change of the row's or an item's size.
 */
function useOnlyWhatFits(rowRef: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const resizes = new ResizeObserver(() => hideWhatOverflows(row));
    const observeItems = (): void => {
      resizes.disconnect();
      resizes.observe(row);
      for (const item of row.children) resizes.observe(item);
      hideWhatOverflows(row);
    };
    const changes = new MutationObserver(observeItems);
    changes.observe(row, { childList: true });
    observeItems();
    return () => {
      changes.disconnect();
      resizes.disconnect();
    };
  }, [rowRef]);
}

/**
 * The row's first line is what overlaps its first item (the line's items are centred on it); the
 * row is as high as that line, and the rest hidden. Sizes are read from the row, its offset parent.
 */
function hideWhatOverflows(row: HTMLElement): void {
  const items = [...row.children].filter((item) => item instanceof HTMLElement);
  const first = items[0];
  if (!first) {
    row.style.height = "";
    return;
  }
  const firstLineEnds = first.offsetTop + first.offsetHeight;
  let lineHeight = 0;
  for (const item of items) {
    // A later line starts a row gap below the first one's end.
    const onFirstLine = item.offsetTop <= firstLineEnds;
    const overflows =
      !onFirstLine || item.offsetLeft < 0 || item.offsetLeft + item.offsetWidth > row.clientWidth;
    item.toggleAttribute("data-overflowing", overflows);
    item.inert = overflows;
    if (onFirstLine) lineHeight = Math.max(lineHeight, item.offsetTop + item.offsetHeight);
  }
  row.style.height = `${lineHeight}px`;
}
