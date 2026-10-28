import { useQuery } from "@tanstack/react-query";
import { Icon } from "@the-office/ui";
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { decisionQueries } from "../../api/conversations.ts";
import { ideaQueries, initiativeQueries, taskQueries } from "../../api/work.ts";
import {
  matchingMentionables,
  MENTION_KINDS,
  mentionables,
  mentionQueryAt,
  withMentionLinks,
  type Mentionable,
  type MentionQuery,
} from "./mention-words.ts";

/** What the composer wires into its field, and the picker it shows over it. */
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

/**
 * Mentions in a composer (prototypes/app/conversation.js, the @ picker): typing `@` offers the
 * Tasks, open Decisions and Ideas whose words match; arrows move, Enter or Tab picks, Esc closes.
 * The draft shows `@` and the record's name; the message sent links it to the record's page.
 */
export function useMentions(draft: string, setDraft: (draft: string) => void): Mentions {
  const field = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<MentionQuery>();
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<readonly Mentionable[]>([]);
  const { records, loading } = useMentionables(query !== undefined);
  const shown = query === undefined ? [] : matchingMentionables(records, query.query);

  const follow = (element: HTMLTextAreaElement): void => {
    field.current = element;
    const typing = mentionQueryAt(element.value, element.selectionStart);
    // A record just picked is followed by its name: typing on after it isn't a new query.
    const pickedOne =
      typing && picked.some(({ label }) => `${typing.query} `.startsWith(`${label} `));
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

  const pick = (record: Mentionable | undefined): void => {
    const element = field.current;
    if (!record || !element || !query) return;
    const name = `@${record.label} `;
    const before = draft.slice(0, query.start);
    writeDraft(
      `${before}${name}${draft.slice(element.selectionStart)}`,
      before.length + name.length,
    );
    setPicked((earlier) => [...earlier, record]);
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
  const tasks = useQuery({ ...taskQueries.list(), enabled: open });
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
  readonly shown: readonly Mentionable[];
  readonly index: number;
  readonly loading: boolean;
  readonly onPick: (record: Mentionable) => void;
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
        {shown.map((record, at) => (
          <li
            key={record.path}
            role="option"
            aria-selected={at === index}
            className={at === index ? "on" : undefined}
            // mousedown, not click: the field keeps its focus and caret while a record is picked.
            onMouseDown={(event) => {
              event.preventDefault();
              onPick(record);
            }}
          >
            <Icon name={MENTION_KINDS[record.kind].icon} size={14} />
            <span className="mention-picker-label">{record.label}</span>
            <span className="mention-picker-kind">{MENTION_KINDS[record.kind].word}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
