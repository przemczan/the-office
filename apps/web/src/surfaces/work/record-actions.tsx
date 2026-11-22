import { Button, Icon, type ButtonProps, type MenuItem } from "@the-office/ui";
import { Fragment, useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";

/**
 * What kind of thing an action does, which colours it (docs/spec/4.1-ui-rules.md, Action tones):
 * go moves the work forward, plan talks it through with someone, hold pauses it or has it wait,
 * stop stops it or takes it out. An action that opens or rearranges something has none.
 */
export type ActionTone = "go" | "plan" | "hold" | "stop";

export type RecordActionVariant = "primary" | "secondary" | "ghost";

/**
 * One action on a Task, an Initiative or an Idea, defined once: a button in its row of actions,
 * as long as it fits there, and an item of its More menu always.
 */
export interface RecordAction {
  /** Unique among the record's actions. */
  readonly key: string;
  readonly label: string;
  readonly icon: string;
  readonly variant?: RecordActionVariant;
  readonly tone?: ActionTone;
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
  /**
   * The window the action opens, such as one asking first, while it is open: the record's More
   * menu (`TaskMenu`) shows it, as the menu is there whether or not the button fits the row.
   */
  readonly dialog?: ReactNode;
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
  const variant = action.variant ?? "secondary";
  return (
    <Button
      variant={variant}
      {...(size && { size })}
      {...(action.tone && { className: actionToneClassName(action.tone, variant) })}
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
 * The classes that colour a button, or a link drawn as one, by its action's tone (work.css): a
 * primary one keeps its fill and only its icon takes the tone.
 */
export function actionToneClassName(tone: ActionTone, variant: RecordActionVariant): string {
  return `action-tone-${tone} action-tone-on-${variant}`;
}

/** An action's icon in its tone, where only the icon shows it, as in a menu. */
export function ActionToneIcon({
  tone,
  name,
  size,
}: {
  readonly tone: ActionTone | undefined;
  readonly name: string;
  readonly size: number;
}): ReactNode {
  const icon = <Icon name={name} size={size} />;
  if (!tone) return icon;
  return <span className={`action-tone-${tone} action-tone-icon`}>{icon}</span>;
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
    icon: <ActionToneIcon tone={action.tone} name={action.icon} size={14} />,
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
  const root = useRef<HTMLDivElement>(null);
  const row = useRef<HTMLDivElement>(null);
  useOnlyWhatFits(root, row);
  return (
    <div ref={root} className={className ? `record-actions ${className}` : "record-actions"}>
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
function useOnlyWhatFits(
  rootRef: RefObject<HTMLElement | null>,
  rowRef: RefObject<HTMLElement | null>,
): void {
  useLayoutEffect(() => {
    const root = rootRef.current;
    const row = rowRef.current;
    if (!root || !row) return;
    const fit = (): void => {
      hideWhatOverflows(row);
      keepRoomForTheFirst(root, row);
    };
    const resizes = new ResizeObserver(fit);
    const observeItems = (): void => {
      resizes.disconnect();
      resizes.observe(row);
      for (const item of row.children) resizes.observe(item);
      fit();
    };
    const changes = new MutationObserver(observeItems);
    changes.observe(row, { childList: true });
    observeItems();
    return () => {
      changes.disconnect();
      resizes.disconnect();
    };
  }, [rootRef, rowRef]);
}

/**
 * The least width the actions take where they are laid out, their first action and the rest of
 * the line (the More menu): a narrower row would hide even the first, leaving only its blank room,
 * so the layout around them, such as the head, wraps them onto a line of their own instead.
 */
function keepRoomForTheFirst(root: HTMLElement, row: HTMLElement): void {
  const first = row.firstElementChild;
  if (!first) {
    root.style.removeProperty("--record-actions-least-width");
    return;
  }
  const gap = Number.parseFloat(getComputedStyle(root).columnGap) || 0;
  let leastWidth = first.getBoundingClientRect().width;
  for (const other of root.children) {
    if (other !== row) leastWidth += gap + other.getBoundingClientRect().width;
  }
  root.style.setProperty("--record-actions-least-width", `${Math.ceil(leastWidth)}px`);
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
