import { useQuery } from "@tanstack/react-query";
import type { Thread } from "@the-office/contracts";
import { Button, Icon } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { threadQueries } from "../../api/conversations.ts";
import { roleQueries } from "../../api/people.ts";
import { threadTitle } from "../../shell/conversation/thread-title.ts";
import { DetailsSwitch } from "../../shell/conversation/details-switch.tsx";
import { ThreadLog, ThreadTitle } from "../../shell/conversation/thread-view.tsx";
import { roleFirstName, roleName } from "../../shell/person-name.ts";
import { PersonTag } from "../../shell/person-tag.tsx";
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
  foldedLine,
  threadsInOrder,
  withChapterOpen,
  withChaptersStarted,
  type ChapterFolds,
} from "./timeline-words.ts";
import { toLineNow, toLinePicked, type ToLine } from "./to-line.ts";
import { chapterElementId, useTimelineScroll } from "./use-timeline-scroll.ts";

const NO_FOLDS: ChapterFolds = new Map();

/**
 * Every Thread of an Initiative as chapters of one log, in the order they started, over one
 * composer. The Thread the user is on is the one the To line writes to. A folded chapter draws none
 * of its messages. It stays mounted in a closed drawer, where everything landing counts as out of
 * view.
 */
export function ThreadTimeline({
  threads,
  asked,
  onAsked,
  readOnlyReason,
}: {
  readonly threads: readonly Thread[];
  /** The Thread the address names. */
  readonly asked: string | undefined;
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
  const inOrder = threadsInOrder(threads);
  const newest = inOrder.at(-1)?.id;
  const placed = threadsSeen(
    seen,
    threads.map(({ id }) => id),
    asked,
  );
  // A link followed unfolds its Thread, even one the user folded, and writes there.
  const followed = asked !== undefined && (seen === undefined || seen.asked !== asked);
  const to =
    followed && inOrder.some(({ id }) => id === asked)
      ? toLinePicked(asked, newest)
      : toLineNow(line, newest, drafting);
  const toId = to.threadId;
  const current =
    toId !== undefined && placed.fresh.has(toId) ? withThreadSeen(placed, toId) : placed;
  // A change in the Threads changes these here, before they are drawn.
  if (current !== seen) setSeen(current);
  if (to !== line) setLine(to);
  const shownId = toId ?? current.shownId;
  const started = withChaptersStarted(folds, new Set(shownId === undefined ? [] : [shownId]));
  const unfolded = followed ? withChapterOpen(started, asked, true) : started;
  if (unfolded !== folds) setFolds(unfolded);
  const newMessages = useNewMessages(
    shownId === undefined ? [] : [shownId],
    (threadId) => !outOfSight && unfolded.get(threadId) === true && follows(threadId),
  );

  const newestThreadId = newMessages.threadId;

  const personName = (thread: Thread): string => roleFirstName(thread.roleKey, roles);
  const personLabel = (thread: Thread): string => roleName(thread.roleKey, roles);
  const toggle = (threadId: string, open: boolean): void => {
    setFolds(withChapterOpen(unfolded, threadId, open));
    if (open) setSeen(withThreadSeen(current, threadId));
    // Folded, the Thread the address names couldn't be reached again by the same link.
    else if (threadId === asked) onAsked(undefined);
  };
  const goToNewest = (threadId: string): void => {
    toggle(threadId, true);
    follow(newest === threadId ? undefined : threadId);
  };
  return (
    <ConversationPanel unread={newMessages.count}>
      <header className="timeline-head">
        <div className="timeline-head-title">
          <h3>Conversation</h3>
          <p>Every Thread of this Initiative in order, the newest last</p>
        </div>
        <DetailsSwitch />
        <CloseConversation />
      </header>
      <div className="timeline-view">
        <div className="timeline" ref={scroller}>
          <div className="timeline-chapters" ref={chapters}>
            {inOrder.map((thread) => (
              <ThreadChapter
                key={thread.id}
                thread={thread}
                personName={personName(thread)}
                personLabel={personLabel(thread)}
                open={unfolded.get(thread.id) === true}
                isNew={current.fresh.has(thread.id)}
                onToggle={(open) => toggle(thread.id, open)}
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
        threads={inOrder}
        toId={toId}
        personName={personName}
        personLabel={personLabel}
        readOnlyReason={readOnlyReason}
        onDrafting={setDrafting}
        onSent={goToNewest}
        onPick={(threadId) => {
          setLine(toLinePicked(threadId, newest));
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
  personLabel,
  open,
  isNew,
  onToggle,
}: {
  readonly thread: Thread;
  readonly personName: string;
  /** Their name and title. */
  readonly personLabel: string;
  readonly open: boolean;
  /** Started while the page was open and not looked at yet. */
  readonly isNew: boolean;
  readonly onToggle: (open: boolean) => void;
}): ReactNode {
  const title = threadTitle(thread, personName);
  return (
    <section className="chapter" id={chapterElementId(thread.id)} aria-label={title}>
      <div className={open ? "chapter-head chapter-head-open" : "chapter-head"}>
        <div className="chapter-head-line">
          <ThreadTitle thread={thread} personName={personName}>
            <button
              type="button"
              className="chapter-toggle"
              aria-label={title}
              aria-expanded={open}
              onClick={() => onToggle(!open)}
            >
              <Icon name="chevron-right" size={14} />
            </button>
            <PersonTag roleKey={thread.roleKey} name={personName} label={personLabel} />
            <span className="chapter-place">{thread.title}</span>
          </ThreadTitle>
          <div className="chapter-facts">
            {isNew && <span className="task-thread-new">New</span>}
            <span className="chapter-time">{clockOf(thread.startedAt)}</span>
          </div>
        </div>
      </div>
      {open ? (
        <ChapterLog threadId={thread.id} personName={personName} />
      ) : (
        <button type="button" className="chapter-line" onClick={() => onToggle(true)}>
          {foldedLine(thread)}
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
