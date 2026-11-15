import { Icon, IconButton } from "@the-office/ui";
import { useEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { PersonAvatar } from "../person-avatar.tsx";
import { StandingDot } from "./chat-standing.tsx";
import type { ChatTab } from "./chat-store.ts";
import { chatStanding, type ChatPerson } from "./chat-words.ts";

/**
 * A tab for each person open in the drawer, to switch between them without the person switch. Only
 * the people still offered in the chat show: one whose chat is off, or who was let go, has none.
 */
export function ChatTabs({
  tabs,
  shown,
  people,
  onShow,
  onClose,
}: {
  readonly tabs: readonly ChatTab[];
  /** The person shown, by their Role's key. */
  readonly shown: string | undefined;
  readonly people: readonly ChatPerson[];
  readonly onShow: (roleKey: string) => void;
  readonly onClose: (roleKey: string) => void;
}): ReactNode {
  const row = useRef<HTMLDivElement>(null);
  const tabElements = useRef(new Map<string, HTMLButtonElement>());
  const open = tabs.flatMap(({ roleKey }) => {
    const person = people.find(({ role }) => role.key === roleKey);
    return person ? [person] : [];
  });
  useShownTabInView(row, tabElements, shown);
  if (open.length === 0) return null;

  const focusTab = (index: number): void => {
    const person = open.at(index % open.length);
    if (person) tabElements.current.get(person.role.key)?.focus();
  };
  const close = (index: number): void => {
    const closing = open[index];
    if (!closing) return;
    // The shown tab's neighbour takes its place, and the focus with it.
    if (closing.role.key === shown) {
      const next = open[index + 1] ?? open[index - 1];
      if (next) tabElements.current.get(next.role.key)?.focus();
    }
    onClose(closing.role.key);
  };
  const onKeyDown = (event: KeyboardEvent, index: number): void => {
    const move: Record<string, (() => void) | undefined> = {
      ArrowRight: () => focusTab(index + 1),
      ArrowLeft: () => focusTab(index - 1),
      Home: () => focusTab(0),
      End: () => focusTab(-1),
      Delete: () => close(index),
    };
    const action = move[event.key];
    if (!action) return;
    event.preventDefault();
    action();
  };

  return (
    <div ref={row} className="chat-tabs" role="tablist" aria-label="People open in the chat">
      {open.map(({ role, activity }, index) => {
        const selected = role.key === shown;
        const standing = chatStanding(activity);
        return (
          <div key={role.key} className="chat-tab" role="presentation">
            <button
              ref={(element) => {
                if (element) tabElements.current.set(role.key, element);
                else tabElements.current.delete(role.key);
              }}
              type="button"
              className="chat-tab-person"
              role="tab"
              aria-selected={selected}
              aria-keyshortcuts="Delete"
              tabIndex={selected ? 0 : -1}
              title={`${role.card.name} · ${standing.words}`}
              onClick={() => onShow(role.key)}
              onKeyDown={(event) => onKeyDown(event, index)}
            >
              <span aria-hidden="true">
                <PersonAvatar roleKey={role.key} name={role.card.name} size="xs" />
              </span>
              <span className="chat-tab-name">{role.card.name}</span>
              <StandingDot standing={standing} />
            </button>
            {/* Out of the Tab order, as a tablist is one stop: Delete on a tab closes it too. */}
            <IconButton
              icon={<Icon name="x" size={12} />}
              label={`Close the chat with ${role.card.name}`}
              size="xs"
              tabIndex={-1}
              onClick={() => close(index)}
            />
          </div>
        );
      })}
    </div>
  );
}

/** Keeps the shown tab in view as the person shown changes. */
function useShownTabInView(
  row: RefObject<HTMLDivElement | null>,
  tabElements: RefObject<ReadonlyMap<string, HTMLElement>>,
  shown: string | undefined,
): void {
  useEffect(() => {
    const frame = row.current;
    const item = shown === undefined ? undefined : tabElements.current.get(shown)?.parentElement;
    if (frame && item) scrollIntoRow(frame, item);
  }, [row, tabElements, shown]);
}

/**
 * Scrolls the row, and only the row, so the item is in view: scrollIntoView would scroll the page
 * and the drawer too.
 */
function scrollIntoRow(row: HTMLElement, item: HTMLElement): void {
  // The row is positioned, so an item's offset is from the row's start.
  const start = item.offsetLeft;
  const end = start + item.offsetWidth;
  if (start < row.scrollLeft) row.scrollLeft = start;
  else if (end > row.scrollLeft + row.clientWidth) row.scrollLeft = end - row.clientWidth;
}
