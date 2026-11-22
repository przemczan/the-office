import { useQuery } from "@tanstack/react-query";
import type { OpenPage } from "@the-office/contracts";
import { Icon } from "@the-office/ui";
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { decisionQueries } from "../../api/conversations.ts";
import { ideaQueries, initiativeQueries, useEveryTask } from "../../api/work.ts";
import { OpenPageChip } from "../open-page-chip.tsx";
import {
  matchingMentionables,
  MENTION_KINDS,
  mentionables,
  mentionQueryAt,
  offersOpenPage,
  OPEN_PAGE_MENTION,
  withMentionLinks,
  type Mentionable,
  type MentionQuery,
} from "./mention-words.ts";
import "./mentions.css";

/** What a field wires in to mention records, and the picker it shows by it. */
export interface Mentions {
  readonly onCaret: (field: HTMLTextAreaElement) => void;
  readonly onKeyDownFirst: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean;
  /** Types an `@` at the caret, as the `@` button does, and opens the picker. */
  readonly start: () => void;
  /** The draft as sent: each record picked still in it, linked to its page. */
  readonly linked: (draft: string) => string;
  /** Forgets the records picked, once the message is sent. */
  readonly clear: () => void;
  readonly picker: ReactNode;
}

/** What the picker offers: the page open beside the chat drawer, or a record. */
type PickerEntry = { readonly kind: "open-page"; readonly page: OpenPage } | Mentionable;

/**
 * Mentions in a field (prototypes/app/conversation.js, the @ picker), the chat's composer or a Task's
 * Description: typing `@` offers the Tasks, Initiatives, open Decisions and Ideas whose words match;
 * arrows move, Enter or Tab picks, Esc closes. The text shows `@` and the record's name; the text
 * sent or saved links it to the record's page. Given the Open page, as the chat drawer's composer
 * is, the picker offers it first, written `@open page` (spec §2.4).
 */
export function useMentions(
  draft: string,
  setDraft: (draft: string) => void,
  openPage?: OpenPage,
): Mentions {
  const field = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<MentionQuery>();
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<readonly Mentionable[]>([]);
  const { records, loading } = useMentionables(query !== undefined);
  const shown: readonly PickerEntry[] =
    query === undefined
      ? []
      : [
          ...(openPage && offersOpenPage(query.query)
            ? [{ kind: "open-page" as const, page: openPage }]
            : []),
          ...matchingMentionables(records, query.query),
        ];
  const pickedNames = [
    ...(openPage ? [OPEN_PAGE_MENTION] : []),
    ...picked.map(({ label }) => label),
  ];

  const follow = (element: HTMLTextAreaElement): void => {
    field.current = element;
    const typing = mentionQueryAt(element.value, element.selectionStart);
    // A record just picked is followed by its name: typing on after it isn't a new query.
    const pickedOne =
      typing && pickedNames.some((name) => `${typing.query} `.startsWith(`${name} `));
    setQuery(pickedOne ? undefined : typing);
    if (typing?.query !== query?.query) setIndex(0);
  };

  /** Writes the draft here, then puts the caret at `caret` once the field shows it. */
  const writeDraft = (
    text: string,
    caret: number,
    then?: (element: HTMLTextAreaElement) => void,
  ): void => {
    setDraft(text);
    requestAnimationFrame(() => {
      const element = field.current;
      if (!element) return;
      element.focus();
      element.setSelectionRange(caret, caret);
      then?.(element);
    });
  };

  const pick = (entry: PickerEntry | undefined): void => {
    const element = field.current;
    if (!entry || !element || !query) return;
    const name = `@${entry.kind === "open-page" ? OPEN_PAGE_MENTION : entry.label} `;
    const before = draft.slice(0, query.start);
    writeDraft(
      `${before}${name}${draft.slice(element.selectionStart)}`,
      before.length + name.length,
    );
    if (entry.kind !== "open-page") setPicked((earlier) => [...earlier, entry]);
    setQuery(undefined);
  };

  const onKeyDownFirst = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (query === undefined || event.nativeEvent.isComposing) return false;
    const move = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (move !== undefined && shown.length > 0) {
      setIndex((current) => (current + move + shown.length) % shown.length);
    } else if ((event.key === "Enter" || event.key === "Tab") && shown.length > 0) {
      pick(shown[index]);
    } else if (event.key === "Escape") {
      // The picker is the innermost thing open: Esc closes it, not the chat around it.
      event.stopPropagation();
      setQuery(undefined);
    } else {
      return false;
    }
    event.preventDefault();
    return true;
  };

  const start = (): void => {
    const element = field.current;
    const at = element?.selectionStart ?? draft.length;
    const typed = at > 0 && !/\s/.test(draft[at - 1] ?? "") ? " @" : "@";
    writeDraft(
      `${draft.slice(0, at)}${typed}${draft.slice(element?.selectionEnd ?? at)}`,
      at + typed.length,
      follow,
    );
  };

  return {
    onCaret: follow,
    onKeyDownFirst,
    start,
    linked: (text) =>
      withMentionLinks(
        text,
        picked.filter(({ label }) => text.includes(`@${label}`)),
      ),
    clear: () => setPicked([]),
    picker: query !== undefined && (
      <MentionPicker
        query={query.query}
        shown={shown}
        index={index}
        loading={loading}
        onPick={pick}
      />
    ),
  };
}

/** The Tasks, Initiatives, open Decisions and Ideas, read once the picker first opens. */
function useMentionables(open: boolean): {
  readonly records: Mentionable[];
  readonly loading: boolean;
} {
  const tasks = useEveryTask({ enabled: open });
  const initiatives = useQuery({ ...initiativeQueries.list(), enabled: open });
  const decisions = useQuery({ ...decisionQueries.open(), enabled: open });
  const ideas = useQuery({ ...ideaQueries.list(), enabled: open });
  return {
    records: mentionables(
      tasks.data ?? [],
      initiatives.data ?? [],
      decisions.data ?? [],
      ideas.data ?? [],
    ),
    loading: tasks.isPending || initiatives.isPending || decisions.isPending || ideas.isPending,
  };
}

function MentionPicker({
  query,
  shown,
  index,
  loading,
  onPick,
}: {
  readonly query: string;
  readonly shown: readonly PickerEntry[];
  readonly index: number;
  readonly loading: boolean;
  readonly onPick: (entry: PickerEntry) => void;
}): ReactNode {
  const id = useId();
  if (shown.length === 0) {
    return (
      <div className="mention-picker" role="status">
        <p className="mention-none">
          {loading ? "Reading The Office's records…" : `Nothing matches “${query}”.`}
        </p>
      </div>
    );
  }
  return (
    <div className="mention-picker">
      <p className="mention-picker-title" id={id}>
        Mention a record
      </p>
      <ul role="listbox" aria-labelledby={id}>
        {shown.map((entry, at) => (
          <li
            key={entry.kind === "open-page" ? "open-page" : entry.path}
            role="option"
            aria-selected={at === index}
            className={at === index ? "on" : undefined}
            // mousedown, not click: the field keeps its focus and caret while a record is picked.
            onMouseDown={(event) => {
              event.preventDefault();
              onPick(entry);
            }}
          >
            {entry.kind === "open-page" ? (
              <OpenPageOption page={entry.page} />
            ) : (
              <>
                <Icon name={MENTION_KINDS[entry.kind].icon} size={14} />
                <span className="mention-picker-label">{entry.label}</span>
                <span className="mention-picker-kind">{MENTION_KINDS[entry.kind].word}</span>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The Open page as the picker offers it: its words, and its record's chip, which is only shown here,
 * as picking the option mustn't follow the chip's link.
 */
function OpenPageOption({ page }: { readonly page: OpenPage }): ReactNode {
  return (
    <>
      <Icon name="app-window" size={14} />
      <span className="mention-picker-label">{OPEN_PAGE_MENTION}</span>
      <span className="mention-picker-open-page" inert>
        <OpenPageChip page={page} />
      </span>
    </>
  );
}
