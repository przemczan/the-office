import { useQuery } from "@tanstack/react-query";
import type { Role, Thread } from "@the-office/contracts";
import { Button, Icon } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { threadQueries } from "../../api/conversations.ts";
import { roleQueries } from "../../api/people.ts";
import { ContextBar } from "../../shell/conversation/context-bar.tsx";
import { ThreadComposer } from "../../shell/conversation/thread-composer.tsx";
import { threadTitle } from "../../shell/conversation/thread-title.ts";
import { ThreadLog, ThreadTitle } from "../../shell/conversation/thread-view.tsx";
import { clockOf } from "../../shell/time.ts";
import { threadTabs, withTabSeen, withTabShown, type ThreadTabs } from "./thread-tabs.ts";
import {
  chaptersStartingOpen,
  foldedLine,
  threadsInOrder,
  withChapterOpen,
  withChaptersStarted,
  type ChapterFolds,
  type ChapterWork,
} from "./timeline-words.ts";
import { chapterElementId, useTimelineScroll } from "./use-timeline-scroll.ts";

const NO_FOLDS: ChapterFolds = new Map();

/**
 * Every Thread of a record as chapters of one log, in the order they started, over one composer.
 * `threadTabs` keeps the Thread the user is on: where the address sends them, else the newest, and
 * it stays that Thread when a new one starts. A folded chapter reads none of its messages.
 */
export function ThreadTimeline({
  threads,
  asked,
  holdingOpenDecision,
  waitingOnYou,
  workOf,
  onAsked,
  readOnlyReason,
}: {
  readonly threads: readonly Thread[];
  /** The Thread the address names. */
  readonly asked: string | undefined;
  readonly holdingOpenDecision: ReadonlySet<string>;
  /** Those of them whose Decision is the user's to answer, not a Consultant's. */
  readonly waitingOnYou: ReadonlySet<string>;
  readonly workOf: (threadId: string) => ChapterWork;
  /** The address keeps up, so that a link to a Thread works again; undefined takes it off. */
  readonly onAsked: (threadId: string | undefined) => void;
  /** Why the record's Threads can be read but not continued, once it ended. */
  readonly readOnlyReason: string | undefined;
}): ReactNode {
  const roles = useQuery(roleQueries.list()).data;
  const [tabs, setTabs] = useState<ThreadTabs>();
  const [folds, setFolds] = useState(NO_FOLDS);
  const { scroller, chapters } = useTimelineScroll(asked);
  const current = threadTabs(
    tabs,
    threads.map(({ id }) => id),
    asked,
  );
  // A Thread added since the last render changes these here, before they are drawn.
  if (current !== tabs) setTabs(current);
  const started = withChaptersStarted(
    folds,
    chaptersStartingOpen(current.shownId, holdingOpenDecision),
  );
  // A link followed unfolds its Thread, even one the user folded.
  const followed = asked !== undefined && tabs !== undefined && tabs.asked !== asked;
  const unfolded = followed ? withChapterOpen(started, asked, true) : started;
  if (unfolded !== folds) setFolds(unfolded);

  const shown = threads.find(({ id }) => id === current.shownId);
  const personName = (thread: Thread): string => nameOf(thread.roleKey, roles);
  const toggle = (threadId: string, open: boolean): void => {
    setFolds(withChapterOpen(unfolded, threadId, open));
    if (open) setTabs(withTabSeen(current, threadId));
    // Folded, the Thread the address names couldn't be reached again by the same link.
    else if (threadId === asked) onAsked(undefined);
  };
  return (
    <>
      <header className="timeline-head">
        <h3>Conversation</h3>
        <p>Every Thread in order, the newest last</p>
      </header>
      <div className="timeline" ref={scroller}>
        <div className="timeline-chapters" ref={chapters}>
          {threadsInOrder(threads).map((thread) => (
            <ThreadChapter
              key={thread.id}
              thread={thread}
              personName={personName(thread)}
              work={workOf(thread.id)}
              open={unfolded.get(thread.id) === true}
              isNew={current.fresh.has(thread.id)}
              waiting={waitingOnYou.has(thread.id)}
              writingHere={thread.id === current.shownId}
              canWrite={readOnlyReason === undefined}
              onToggle={(open) => toggle(thread.id, open)}
              onWriteHere={() => {
                setTabs(withTabShown(current, thread.id));
                onAsked(thread.id);
              }}
            />
          ))}
        </div>
      </div>
      {shown && (
        <TimelineFoot
          key={shown.id}
          threadId={shown.id}
          personName={personName(shown)}
          readOnlyReason={readOnlyReason}
        />
      )}
    </>
  );
}

function ThreadChapter({
  thread,
  personName,
  work,
  open,
  isNew,
  waiting,
  writingHere,
  canWrite,
  onToggle,
  onWriteHere,
}: {
  readonly thread: Thread;
  readonly personName: string;
  readonly work: ChapterWork;
  readonly open: boolean;
  /** Started while the page was open and not looked at yet. */
  readonly isNew: boolean;
  readonly waiting: boolean;
  readonly writingHere: boolean;
  readonly canWrite: boolean;
  readonly onToggle: (open: boolean) => void;
  readonly onWriteHere: () => void;
}): ReactNode {
  const title = threadTitle(thread, personName);
  return (
    <section className="chapter" id={chapterElementId(thread.id)} aria-label={title}>
      <div className="chapter-head">
        <ThreadTitle thread={thread} personName={personName}>
          <button
            type="button"
            className="chapter-toggle"
            aria-expanded={open}
            onClick={() => onToggle(!open)}
          >
            <Icon name={open ? "chevron-down" : "chevron-right"} size={14} />
            <span className="chapter-title">{title}</span>
          </button>
        </ThreadTitle>
        <div className="chapter-facts">
          {isNew && <span className="task-thread-new">New</span>}
          {waiting && (
            <span className="task-thread-waiting" title="A Decision waits on you">
              1<span className="visually-hidden"> Decision waiting on you</span>
            </span>
          )}
          {/* A Thread's title names the Stage it began in; a `continue` session goes on to others. */}
          {work.stageNames.length > 1 && <span>{work.stageNames.join(" · ")}</span>}
          <span>{clockOf(thread.startedAt)}</span>
          {canWrite && !writingHere && (
            <Button size="sm" variant="ghost" onClick={onWriteHere}>
              Write here
            </Button>
          )}
        </div>
      </div>
      {open ? (
        <ChapterLog threadId={thread.id} personName={personName} />
      ) : (
        <button type="button" className="chapter-line" onClick={() => onToggle(true)}>
          {foldedLine(thread, work.handoverNote)}
        </button>
      )}
    </section>
  );
}

function ChapterLog({
  threadId,
  personName,
}: {
  readonly threadId: string;
  readonly personName: string;
}): ReactNode {
  const thread = useQuery(threadQueries.one(threadId)).data;
  return thread ? <ThreadLog thread={thread} personName={personName} inTimeline /> : null;
}

/** The Thread being written in, under the timeline, its context label over the composer. */
function TimelineFoot({
  threadId,
  personName,
  readOnlyReason,
}: {
  readonly threadId: string;
  readonly personName: string;
  readonly readOnlyReason: string | undefined;
}): ReactNode {
  const thread = useQuery(threadQueries.one(threadId)).data;
  if (!thread) return null;
  return (
    <div className="timeline-foot">
      {readOnlyReason === undefined && (
        <p className="timeline-writing-in">Writing in {threadTitle(thread, personName)}</p>
      )}
      <ContextBar thread={thread} personName={personName} />
      <ThreadComposer
        thread={thread}
        personName={personName}
        readOnlyReason={readOnlyReason}
        autoFocus={false}
      />
    </div>
  );
}

function nameOf(roleKey: string, roles: readonly Role[] | undefined): string {
  return roles?.find(({ key }) => key === roleKey)?.card.name ?? roleKey;
}
