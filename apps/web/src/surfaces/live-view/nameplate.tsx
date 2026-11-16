import { Popover, Tooltip } from "@the-office/ui";
import { type CSSProperties, type ReactNode, type RefCallback, useState } from "react";
import { PersonAvatar } from "../../shell/person-avatar.tsx";
import { agentWords, isNewHire, type PersonNames } from "./live-states.ts";
import type { FigureAnchor, RecordTitles, StageView } from "./live-view-types.ts";
import type { ShownPerson } from "./office-people.ts";
import { pressWords } from "./press-words.ts";
import { WorkLinks } from "./work-links.tsx";

/** Under two CSS pixels per art pixel a nameplate keeps the Avatar alone (design decision 4). */
const COMPACT_BELOW_SCALE = 2;

export interface NameplatesProps {
  readonly shown: readonly ShownPerson[];
  readonly view: StageView;
  readonly now: Date;
  readonly titles: RecordTitles;
  readonly names: PersonNames;
  /** The figure the pointer is over on the floor, whose tooltip shows. */
  readonly hoveredKey: string | null;
  /** Whose popover is open. */
  readonly popoverKey: string | null;
  readonly onPopoverChange: (roleKey: string, open: boolean) => void;
  /** Each nameplate's element by Role key, which the stage moves as its figure walks. */
  readonly plates: Map<string, HTMLElement>;
}

/** Where a nameplate hangs: its middle under the figure's feet. */
function nameplateTransform(x: number, bottom: number): string {
  return `translate(${x}px, ${bottom}px) translateX(-50%)`;
}

/** Moves a nameplate with its walking figure, straight in the DOM; hidden while the figure is outside. */
export function placeNameplate(
  element: HTMLElement,
  x: number,
  bottom: number,
  outside: boolean,
): void {
  element.style.transform = nameplateTransform(x, bottom);
  element.style.visibility = outside ? "hidden" : "";
}

function byRoleKey(shown: readonly ShownPerson[]): Map<string, ShownPerson> {
  return new Map(shown.map((entry) => [entry.person.roleKey, entry]));
}

/**
 * Everyone shown since the page opened, by Role key, so someone let go keeps their nameplate on the
 * way out: what was shown before, kept in state, with what is shown now over it.
 */
function useEveryoneShown(shown: readonly ShownPerson[]): ReadonlyMap<string, ShownPerson> {
  const [before, setBefore] = useState<ReadonlyMap<string, ShownPerson>>(() => byRoleKey(shown));
  const [seen, setSeen] = useState(shown);
  const everyone = new Map([...before, ...byRoleKey(shown)]);
  if (seen !== shown) {
    setSeen(shown);
    setBefore(everyone);
  }
  return everyone;
}

/** HTML over the canvas, so their words are crisp and follow the palette while the floor follows the hour. */
export function Nameplates({
  shown,
  view,
  now,
  titles,
  names,
  hoveredKey,
  popoverKey,
  onPopoverChange,
  plates,
}: NameplatesProps): ReactNode {
  const everyone = useEveryoneShown(shown);
  const compact = view.scale < COMPACT_BELOW_SCALE;
  return (
    <div className="live-nameplates">
      {view.anchors.map((anchor) => {
        const entry = everyone.get(anchor.roleKey);
        // Someone gone home for the night isn't on the floor, so has no nameplate (the list keeps them).
        if (entry === undefined || (entry.lookState === "home" && !anchor.leaving)) return null;
        const register: RefCallback<HTMLDivElement> = (element) => {
          if (!element) return;
          plates.set(anchor.roleKey, element);
          return () => {
            if (plates.get(anchor.roleKey) === element) plates.delete(anchor.roleKey);
          };
        };
        if (anchor.leaving) {
          return (
            <LeavingNameplate
              key={anchor.roleKey}
              shown={entry}
              anchor={anchor}
              compact={compact}
              register={register}
            />
          );
        }
        return (
          <Nameplate
            key={anchor.roleKey}
            shown={entry}
            anchor={anchor}
            register={register}
            compact={compact}
            isNew={isNewHire(entry.person, now)}
            tooltip={<PersonTooltip shown={entry} titles={titles} names={names} />}
            hovered={hoveredKey === anchor.roleKey}
            popoverOpen={popoverKey === anchor.roleKey}
            onPopoverChange={(open) => onPopoverChange(anchor.roleKey, open)}
          />
        );
      })}
    </div>
  );
}

/** The nameplate's place, as the stage last reported it; the stage moves it while the figure walks. */
function anchorStyle(anchor: FigureAnchor): CSSProperties {
  return {
    transform: nameplateTransform(anchor.x, anchor.bottom),
    visibility: anchor.outside ? "hidden" : undefined,
  };
}

/** Someone let go, on their way out: their name goes with them, with nothing to open. */
function LeavingNameplate({
  shown: { person },
  anchor,
  compact,
  register,
}: {
  readonly shown: ShownPerson;
  readonly anchor: FigureAnchor;
  readonly compact: boolean;
  readonly register: RefCallback<HTMLDivElement>;
}): ReactNode {
  return (
    <div className="live-nameplate" ref={register} style={anchorStyle(anchor)} inert>
      <span className={compact ? "live-nameplate-face compact" : "live-nameplate-face"}>
        <PersonAvatar roleKey={person.roleKey} name={person.name} size="xs" />
        <span className="live-nameplate-name">{person.name}</span>
      </span>
    </div>
  );
}

function Nameplate({
  shown,
  anchor,
  register,
  compact,
  isNew,
  tooltip,
  hovered,
  popoverOpen,
  onPopoverChange,
}: {
  readonly shown: ShownPerson;
  readonly anchor: FigureAnchor;
  readonly register: RefCallback<HTMLDivElement>;
  readonly compact: boolean;
  readonly isNew: boolean;
  readonly tooltip: ReactNode;
  readonly hovered: boolean;
  readonly popoverOpen: boolean;
  readonly onPopoverChange: (open: boolean) => void;
}): ReactNode {
  const { person, lookState } = shown;
  // Held open while the pointer is over the figure; left to the nameplate's own hover and focus otherwise.
  const tooltipOpen = popoverOpen ? false : hovered ? true : undefined;
  // Under the nameplate, so it never covers the figure it is about.
  return (
    <div className="live-nameplate" ref={register} style={anchorStyle(anchor)}>
      <Tooltip content={tooltip} open={tooltipOpen} side="bottom">
        <Popover
          label={person.name}
          triggerClassName={compact ? "live-nameplate-face compact" : "live-nameplate-face"}
          trigger={
            <>
              <PersonAvatar roleKey={person.roleKey} name={person.name} size="xs" />
              <span className="live-nameplate-name">{person.name}</span>
              {isNew && <span className="live-nameplate-new">New</span>}
              <span className={`live-state-dot ${lookState}`} aria-hidden="true" />
            </>
          }
          open={popoverOpen}
          onOpenChange={onPopoverChange}
        >
          <PersonPopover shown={shown} />
        </Popover>
      </Tooltip>
    </div>
  );
}

/** Name and title, the state in words, each running session when there are several, and what a click does. */
function PersonTooltip({
  shown: { person, words, links },
  titles,
  names,
}: {
  readonly shown: ShownPerson;
  readonly titles: RecordTitles;
  readonly names: PersonNames;
}): ReactNode {
  return (
    <span className="live-tooltip">
      <span>
        <b>{person.name}</b> · {person.title}
      </span>
      <span>{words}</span>
      {person.agents.length > 1 &&
        person.agents.map((agent) => (
          <span key={agent.threadId}>{agentWords(agent, titles, names)}</span>
        ))}
      <span className="live-tooltip-press">{pressWords(person, links)}</span>
    </span>
  );
}

/** The tooltip's words with the links, as a tap on a screen without hover shows them too. */
function PersonPopover({
  shown: { person, words, links },
}: {
  readonly shown: ShownPerson;
}): ReactNode {
  return (
    <>
      <p className="popover-head">
        <PersonAvatar roleKey={person.roleKey} name={person.name} size="xs" />
        {person.name}
        <span className="live-popover-title">· {person.title}</span>
      </p>
      <p className="popover-sub">{words}</p>
      <WorkLinks links={links} />
    </>
  );
}
