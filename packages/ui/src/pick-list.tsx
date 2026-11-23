// A list to pick one item from, its details beside it (docs/spec/4.1-ui-rules.md, "List and
// details"): one card with a head naming the list, how many it holds and its main action, rows edge
// to edge split by hairlines, and a foot for what isn't a row. Settings' Engines and Pipelines are
// drawn with it.
import { useId, type ReactNode } from "react";
import { Icon } from "../../../design-system/components/core/Icon.jsx";
import { Tooltip } from "./overlays.tsx";

export interface PickListProps {
  /** The list's name: its heading and its navigation landmark's name. */
  readonly name: string;
  /** How many items it holds, shown beside its name. */
  readonly count: number;
  /** The list's main action, such as "Add an engine", at the head's end. */
  readonly action?: ReactNode;
  /** What shows in place of the rows while there are none: what would fill it and how. */
  readonly empty?: ReactNode;
  /** What isn't a row, such as an action on the picked item, in the card under the rows. */
  readonly foot?: ReactNode;
  /** Words about the list, under the card. */
  readonly note?: ReactNode;
  /** The rows, each a `PickListItem`, or groups of them, each a `PickListGroup`. */
  readonly children?: ReactNode;
}

export function PickList({
  name,
  count,
  action,
  empty,
  foot,
  note,
  children,
}: PickListProps): ReactNode {
  return (
    <div className="pick-list">
      <section className="pick-list-card">
        <header className="pick-list-head">
          <h3 className="pick-list-title">
            {name}
            <span className="pick-list-count">{count}</span>
          </h3>
          {action && <div className="pick-list-action">{action}</div>}
        </header>
        <nav aria-label={name}>
          {count === 0 && empty ? (
            <p className="pick-list-empty">{empty}</p>
          ) : (
            <ul className="pick-list-rows">{children}</ul>
          )}
        </nav>
        {foot && <div className="pick-list-foot">{foot}</div>}
      </section>
      {note && <p className="pick-list-note">{note}</p>}
    </div>
  );
}

export interface PickListGroupProps {
  /** The small heading over the group's rows, such as an engine type. */
  readonly title: string;
  /** The group's rows, each a `PickListItem`. */
  readonly children?: ReactNode;
}

/** Rows of a `PickList` that belong together, under a small heading; the list names it. */
export function PickListGroup({ title, children }: PickListGroupProps): ReactNode {
  const id = useId();
  return (
    <li className="pick-list-group">
      <h4 className="pick-list-group-title" id={id}>
        {title}
      </h4>
      <ul className="pick-list-rows" aria-labelledby={id}>
        {children}
      </ul>
    </li>
  );
}

/** What a caller's own link spreads on itself to be drawn as a row. */
export interface PickListRowParts {
  readonly className: string;
  readonly "aria-current": "page" | undefined;
  readonly children: ReactNode;
}

interface PickListItemContent {
  readonly picked: boolean;
  /** The item's kind as a small tile at the row's start, its label a tooltip and the row's text. */
  readonly icon?: { readonly glyph: ReactNode; readonly label: string };
  /** The first line, cut with an ellipsis; the row's accessible name starts with it. */
  readonly name: ReactNode;
  /** The caption under the name, cut with an ellipsis. */
  readonly line: ReactNode;
  /** `danger` when the line says what is wrong with the item, such as why it is Broken. */
  readonly lineTone?: "danger";
  /** A second caption under the line, such as who builds on the item. */
  readonly secondLine?: ReactNode;
  /** What marks the item at the row's end, such as a badge; it never wraps. */
  readonly aside?: ReactNode;
  /** What needs fixing in the item, as a warning mark at the row's very end. */
  readonly warning?: string;
}

export type PickListItemProps = PickListItemContent &
  (
    | { readonly onPick: () => void; readonly renderLink?: never }
    | {
        /**
         * Draws the row as the caller's own link, such as a router's, which this package doesn't
         * have: the link spreads the parts on itself.
         */
        readonly renderLink: (parts: PickListRowParts) => ReactNode;
        readonly onPick?: never;
      }
  );

export function PickListItem(props: PickListItemProps): ReactNode {
  const { picked } = props;
  const className = picked ? "pick-list-item picked" : "pick-list-item";
  const children = <PickListItemWords {...props} />;
  return (
    <li className="pick-list-row">
      {props.renderLink ? (
        props.renderLink({ className, "aria-current": picked ? "page" : undefined, children })
      ) : (
        <button
          type="button"
          className={className}
          aria-current={picked ? "true" : undefined}
          onClick={props.onPick}
        >
          {children}
        </button>
      )}
    </li>
  );
}

function PickListItemWords({
  icon,
  name,
  line,
  lineTone,
  secondLine,
  aside,
  warning,
}: PickListItemContent): ReactNode {
  return (
    <>
      {icon && (
        <Tooltip content={icon.label}>
          <span className="pick-list-icon" aria-hidden="true">
            {icon.glyph}
          </span>
        </Tooltip>
      )}
      <span className="pick-list-words">
        <span className="pick-list-name">{name}</span>
        <span className={lineTone ? `pick-list-line ${lineTone}` : "pick-list-line"}>
          {icon && <span className="pick-list-hidden">{icon.label} · </span>}
          {line}
        </span>
        {secondLine && <span className="pick-list-line">{secondLine}</span>}
      </span>
      {(aside || warning) && (
        <span className="pick-list-aside">
          {aside}
          {warning && (
            <Tooltip content={warning}>
              <span className="pick-list-warning" role="img" aria-label={warning}>
                <Icon name="triangle-alert" size={14} />
              </span>
            </Tooltip>
          )}
        </span>
      )}
    </>
  );
}
