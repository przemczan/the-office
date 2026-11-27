import {
  Button,
  Icon,
  IconButton,
  SplitButton,
  type ButtonProps,
  type MenuItem,
} from "@the-office/ui";
import { Fragment, useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";

/**
 * What kind of thing an action does, which colours it (docs/spec/4.1-ui-rules.md, Action tones):
 * go moves the work forward, plan talks it through with someone, hold pauses it or has it wait,
 * stop stops it or takes it out. An action that opens or rearranges something has none.
 */
export type ActionTone = "go" | "plan" | "hold" | "stop";

/**
 * Where an action sits (docs/spec/4.1-ui-rules.md, Action tones): go-to is a place the record leads
 * to, an icon in the head; hold holds or takes the work out, and next is the step that moves it on,
 * both in the control bar, hold first, next last; more is the rare step only the More menu lists.
 * Next when left out.
 */
export type ActionZone = "go-to" | "hold" | "next" | "more";

export type RecordActionVariant = "primary" | "secondary" | "ghost";

/**
 * One action on a Task, an Initiative or an Idea, defined once: a button in its row of actions or
 * its control bar, as its zone places it, or an item of its More menu.
 */
export interface RecordAction {
  /** Unique among the record's actions. */
  readonly key: string;
  readonly label: string;
  readonly icon: string;
  readonly variant?: RecordActionVariant;
  readonly tone?: ActionTone;
  readonly zone?: ActionZone;
  /**
   * The key of the action whose split button lists this one, another way to do the same thing,
   * instead of a button of its own.
   */
  readonly alternativeTo?: string;
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
  /** A small word on its button, such as "Auto" while a mode it offers is on. */
  readonly tag?: string;
  /**
   * Choices its split button lists above its alternatives, such as a mode to switch; they make it
   * a split button even with none.
   */
  readonly choices?: readonly MenuItem[];
  /** A mark beside a go-to icon, such as how a pull request ended. */
  readonly mark?: ReactNode;
  /**
   * A go-to icon as the link to its place, given what draws it as an icon: middle-click and copying
   * the link work, as a button's `onSelect` can't offer. The More menu still uses `onSelect`.
   */
  readonly link?: (anchor: GoToAnchor) => ReactNode;
  /**
   * The window the action opens, such as one asking first, while it is open: the record's More
   * menu (`TaskMenu`) shows it, as the menu is there whether or not the button fits the row.
   */
  readonly dialog?: ReactNode;
}

/** What a go-to link takes to look and read as the head's other icons. */
export interface GoToAnchor {
  readonly className: string;
  readonly "aria-label": string;
  readonly title: string;
  readonly children: ReactNode;
}

/** The zone an action sits in. */
export function zoneOf(action: RecordAction): ActionZone {
  return action.zone ?? "next";
}

/** The actions in one of the zones, in their order, leaving out those a split button lists. */
export function actionsInZone(actions: readonly RecordAction[], zone: ActionZone): RecordAction[] {
  return actions.filter((action) => zoneOf(action) === zone && !action.alternativeTo);
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
  if (zoneOf(action) === "go-to") {
    const label = action.ariaLabel ?? action.label;
    const title = action.hint ?? action.label;
    const icon = <Icon name={action.icon} size={16} />;
    const goTo = action.link ? (
      action.link({ className: "link-icon-button", "aria-label": label, title, children: icon })
    ) : (
      <IconButton
        variant="ghost"
        icon={icon}
        label={label}
        title={title}
        disabled={action.disabled}
        onClick={action.onSelect}
      />
    );
    if (action.mark === undefined) return goTo;
    // One item of the row, so the mark is never shown or hidden apart from its icon.
    return (
      <span className="go-to-marked">
        {action.mark}
        {goTo}
      </span>
    );
  }
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

/** What the control bar says about where the work is: a lead, then why these buttons are offered. */
export interface ControlBarWords {
  readonly lead: string;
  readonly words?: ReactNode;
  readonly icon: string;
  readonly tone?: ActionTone;
}

/**
 * The control bar under a record's head (docs/spec/4.1-ui-rules.md, Action tones): a sentence on
 * where the work is, then the hold zone (Pause, Stop, the queue's), a divider and the next step
 * last. An action another one's split button lists is no button of its own. Nothing but the
 * sentence once the record offers no action; it wraps under the sentence on a narrow page.
 */
export function ControlBar({
  words,
  actions,
  size,
  children,
}: {
  readonly words: ControlBarWords;
  readonly actions: readonly RecordAction[];
  readonly size?: ButtonProps["size"];
  /** More lines under the sentence, such as the Overlaps and the Usage estimate. */
  readonly children?: ReactNode;
}): ReactNode {
  const hold = actionsInZone(actions, "hold");
  const next = actionsInZone(actions, "next");
  return (
    <section className="control-bar" aria-label="Controls">
      <div className="control-bar-main">
        <div className={`control-bar-words${words.tone ? ` action-tone-${words.tone}` : ""}`}>
          <Icon name={words.icon} size={16} />
          <span>
            <b>{words.lead}</b> {words.words}
          </span>
        </div>
        {(hold.length > 0 || next.length > 0) && (
          <div className="control-bar-actions">
            {hold.map((action) => (
              <ActionWithAlternatives key={action.key} action={action} all={actions} size={size} />
            ))}
            {hold.length > 0 && next.length > 0 && (
              <span className="control-bar-divider" aria-hidden="true" />
            )}
            {next.map((action) => (
              <ActionWithAlternatives key={action.key} action={action} all={actions} size={size} />
            ))}
          </div>
        )}
      </div>
      {children}
    </section>
  );
}

/** The action as a button, a split button when other actions are other ways to do it. */
function ActionWithAlternatives({
  action,
  all,
  size,
}: {
  readonly action: RecordAction;
  readonly all: readonly RecordAction[];
  readonly size?: ButtonProps["size"];
}): ReactNode {
  const alternatives = all.filter(({ alternativeTo }) => alternativeTo === action.key);
  const choices = action.choices ?? [];
  if (action.control !== undefined || (alternatives.length === 0 && choices.length === 0)) {
    return <RecordActionButton action={action} size={size} />;
  }
  const variant = action.variant ?? "secondary";
  return (
    <SplitButton
      variant={variant}
      {...(size && { size })}
      {...(action.tone && { className: actionToneClassName(action.tone, variant) })}
      iconLeft={<Icon name={action.icon} size={14} />}
      {...(action.hint && { title: action.hint })}
      loading={action.pending ?? false}
      disabled={action.disabled ?? false}
      onClick={action.onSelect}
      menuLabel={`More ways to ${(action.label.split(" · ")[0] ?? action.label).toLowerCase()}`}
      // The bar's buttons end at the page's right edge, so the menu opens leftwards from there.
      menuAlign="end"
      items={[
        ...choices,
        ...(choices.length > 0 && alternatives.length > 0 ? [{ divider: true }] : []),
        ...alternatives.map((alternative) => ({
          icon: <ActionToneIcon tone={alternative.tone} name={alternative.icon} size={14} />,
          label: alternative.label,
          disabled: (alternative.disabled ?? false) || (alternative.pending ?? false),
          onSelect: alternative.onSelect,
        })),
      ]}
    >
      {action.label}
      {action.tag && <span className="action-tag">{action.tag}</span>}
    </SplitButton>
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
