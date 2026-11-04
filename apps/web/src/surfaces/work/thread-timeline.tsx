import { useQuery } from "@tanstack/react-query";
import type { Role, Thread } from "@the-office/contracts";
import { Button, Icon } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { threadQueries } from "../../api/conversations.ts";
import { roleQueries } from "../../api/people.ts";
import { threadTitle } from "../../shell/conversation/thread-title.ts";
import { DetailsSwitch } from "../../shell/conversation/details-switch.tsx";
import { ThreadLog, ThreadTitle } from "../../shell/conversation/thread-view.tsx";
import { clockOf } from "../../shell/time.ts";
import {
  CloseConversation,
  ConversationPanel,
  useConversationDrawer,
} from "./conversation-drawer.tsx";
import { newMessagesWords, useNewMessages } from "./new-messages.ts";
import { threadsSeen, withThreadSeen, type ThreadsSeen } from "./threads-seen.ts";
import { TimelineFoot } from "./timeline-foot.tsx";
import {
  chaptersStartingOpen,
  foldedLine,
  NO_TIMELINE_WORK,
  threadsInOrder,
  withChapterOpen,
  withChaptersStarted,
  type ChapterFolds,
  type ChapterWork,
  type TimelineWork,
} from "./timeline-words.ts";
import { liveThread, toLineNow, toLinePicked, writableThreads, type ToLine } from "./to-line.ts";
import { chapterElementId, useTimelineScroll } from "./use-timeline-scroll.ts";

const NO_FOLDS: ChapterFolds = new Map();

/**
 * Every Thread of a record as chapters of one log, in the order they started, over one composer.
 * The Thread the user is on is the one the To line writes to, else, with none writable, where the
 * address sends them or the newest. A folded chapter draws none of its messages. It stays mounted
 * in a closed drawer, where everything landing counts as out of view.
 */
export function ThreadTimeline({
  threads,
  asked,
  work = NO_TIMELINE_WORK,
  onAsked,
  readOnlyReason,
}: {
  readonly threads: readonly Thread[];
  /** The Thread the address names. */
  readonly asked: string | undefined;
  readonly work?: TimelineWork;
  /** The address keeps up, so that a link to a Thread works again; undefined takes it off. */
  readonly onAsked: (threadId: string | undefined) => void;
  /** Why the record's Threads can be read but not continued, once it ended. */
  readonly readOnlyReason: string | undefined;
}): ReactNode {
  const roles = useQuery(roleQueries.list()).data;
  const [seen, setSeen] = useState<ThreadsSeen>();
  const [folds, setFolds] = useState(NO_FOLDS);
  const [line, setLine] = useState<ToLine>();
  const [drafting, setDrafting] = useState(false);
  const { scroller, chapters, follows, follow } = useTimelineScroll(asked);
  const drawer = useConversationDrawer();
  const outOfSight = drawer.narrow && !drawer.open;
  const { holdingOpenDecision, waitingOnYou, workOf, onShowStage } = work;
  const placed = threadsSeen(
    seen,
    threads.map(({ id }) => id),
    asked,
  );
  const writable = writableThreads(threads, readOnlyReason);
  const writableIds = writable.map(({ id }) => id);
  const live = liveThread(writable, holdingOpenDecision)?.id;
  // A link followed unfolds its Thread, even one the user folded, and writes there if it can.
  const followed = asked !== undefined && (seen === undefined || seen.asked !== asked);
  const to =
    followed && writableIds.includes(asked)
      ? toLinePicked(asked, live)
      : toLineNow(line, writableIds, live, drafting);
  const toId = to.threadId;
  const current =
    toId !== undefined && placed.fresh.has(toId) ? withThreadSeen(placed, toId) : placed;
  // A change in the Threads changes these here, before they are drawn.
  if (current !== seen) setSeen(current);
  if (to !== line) setLine(to);
  const started = withChaptersStarted(
    folds,
    chaptersStartingOpen(toId ?? current.shownId, holdingOpenDecision),
  );
  const unfolded = followed ? withChapterOpen(started, asked, true) : started;
  if (unfolded !== folds) setFolds(unfolded);
  const newMessages = useNewMessages(
    [toId ?? current.shownId, live].filter((threadId) => threadId !== undefined),
    (threadId) => !outOfSight && unfolded.get(threadId) === true && follows(threadId),
  );

  const newestThreadId = newMessages.threadId;

  const personName = (thread: Thread): string => nameOf(thread.roleKey, roles);
  const toggle = (threadId: string, open: boolean): void => {
    setFolds(withChapterOpen(unfolded, threadId, open));
    if (open) setSeen(withThreadSeen(current, threadId));
    // Folded, the Thread the address names couldn't be reached again by the same link.
    else if (threadId === asked) onAsked(undefined);
  };
  const goToNewest = (threadId: string): void => {
    toggle(threadId, true);
    follow(threadsInOrder(threads).at(-1)?.id === threadId ? undefined : threadId);
  };
  return (
    <ConversationPanel unread={newMessages.count}>
      <header className="timeline-head">
        <div className="timeline-head-title">
          <h3>Conversation</h3>
          <p>Every Thread in order, the newest last</p>
        </div>
        <DetailsSwitch />
        <CloseConversation />
      </header>
      <div className="timeline-view">
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
                onToggle={(open) => toggle(thread.id, open)}
                onShowStage={onShowStage}
              />
            ))}
          </div>
        </div>
        {newestThreadId !== undefined && (
          <div className="timeline-new-messages">
            <Button size="sm" onClick={() => goToNewest(newestThreadId)}>
              {newMessagesWords(newMessages.count)}
            </Button>
          </div>
        )}
      </div>
      <TimelineFoot
        threads={threads}
        writable={writable}
        toId={toId}
        closedUnderDraft={to.closedUnderDraft}
        personName={personName}
        readOnlyReason={readOnlyReason}
        onDrafting={setDrafting}
        onSent={goToNewest}
        onPick={(threadId) => {
          setLine(toLinePicked(threadId, live));
          setFolds(withChapterOpen(unfolded, threadId, true));
          onAsked(threadId);
        }}
      />
    </ConversationPanel>
  );
}

function ThreadChapter({
  thread,
  personName,
  work,
  open,
  isNew,
  waiting,
  onToggle,
  onShowStage,
}: {
  readonly thread: Thread;
  readonly personName: string;
  readonly work: ChapterWork;
  readonly open: boolean;
  /** Started while the page was open and not looked at yet. */
  readonly isNew: boolean;
  readonly waiting: boolean;
  readonly onToggle: (open: boolean) => void;
  readonly onShowStage: (stageKey: string) => void;
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
          {work.stages.map(({ key, name }) => (
            <button
              key={key}
              type="button"
              className="chapter-stage"
              aria-label={`Show ${name} on the rail`}
              title={`Show ${name} on the rail`}
              onClick={() => onShowStage(key)}
            >
              <Icon name="route" size={12} />
              {name}
            </button>
          ))}
          <span>{clockOf(thread.startedAt)}</span>
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

function nameOf(roleKey: string, roles: readonly Role[] | undefined): string {
  return roles?.find(({ key }) => key === roleKey)?.card.name ?? roleKey;
}
