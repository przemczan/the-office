import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import {
  ENDED_INITIATIVE_CONVERSATION_WORDS,
  type Initiative,
  type Role,
  type Thread,
} from "@the-office/contracts";
import { Button, Icon, Tabs } from "@the-office/ui";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { threadQueries } from "../../api/conversations.ts";
import { dutyQueries, roleQueries } from "../../api/people.ts";
import { startShapingThread } from "../../api/work.ts";
import { DetailsSwitch } from "../../shell/conversation/details-switch.tsx";
import { threadTitle } from "../../shell/conversation/thread-title.ts";
import { ThreadLoader, ThreadLog, ThreadTitle } from "../../shell/conversation/thread-view.tsx";
import { EmptyCard } from "../../shell/item-card.tsx";
import { roleName } from "../../shell/person-name.ts";
import { PersonTag } from "../../shell/person-tag.tsx";
import { clockOf } from "../../shell/time.ts";
import { useToast } from "../../shell/toasts.tsx";
import { DutyUnheldNote } from "../../shell/duty-unheld-note.tsx";
import { dutyHolderOf } from "../../shell/use-duty-holder.ts";
import {
  CloseConversation,
  ConversationPanel,
  useConversationDrawer,
  useDrawerFollowsAddress,
} from "./conversation-drawer.tsx";
import { TabLabel } from "./conversation-parts.tsx";
import {
  emptyInitiativeTabWords,
  firstInitiativeTab,
  initiativeTabAsked,
  initiativeTabLine,
  initiativeTabs,
  threadAsked,
  unfilledTabName,
  type InitiativeTab,
} from "./initiative-conversation-tabs.ts";
import { PlanInitiativeWith } from "./initiative-plan-with.tsx";
import { InitiativeTabFoot } from "./initiative-tab-foot.tsx";
import { newMessagesWords, useNewMessagesByThread } from "./new-messages.ts";
import { threadsSeen, withThreadSeen, type ThreadsSeen } from "./threads-seen.ts";
import {
  foldedLine,
  withChapterOpen,
  withChaptersStarted,
  type ChapterFolds,
} from "./timeline-words.ts";
import { toLineNow, toLinePicked, type ToLine } from "./to-line.ts";
import { chapterElementId, useTimelineScroll } from "./use-timeline-scroll.ts";

const NO_FOLDS: ChapterFolds = new Map();
const NO_LINES: ReadonlyMap<string, ToLine> = new Map();
const NOBODY_DRAFTING: ReadonlySet<string> = new Set();

/**
 * The Initiative's conversation: a tab per person, those of whoever holds Shapes Initiatives and
 * Plans always, each holding that person's Threads on the Initiative. The address names a person's
 * tab by their key or by one of their Threads, which then unfolds and takes the To line.
 */
export function InitiativeConversation({
  initiative,
}: {
  readonly initiative: Initiative;
}): ReactNode {
  const { initiativeThread } = useSearch({ from: "/work/initiatives/$initiativeId" });
  const threads = useQuery(threadQueries.onInitiative(initiative.id)).data;
  const duties = useQuery(dutyQueries.list()).data;
  const roles = useQuery(roleQueries.list()).data;
  useDrawerFollowsAddress(
    threads
      ? { threadId: initiativeThread, decisionId: undefined, decisionIsOpen: false }
      : undefined,
  );
  const [held, setHeld] = useState<string>();
  // The pinned tabs wait for who holds their duties, so a holder's tab never stands in for a
  // moment.
  const tabs =
    threads &&
    duties &&
    roles &&
    initiativeTabs(threads, {
      shaper: dutyHolderOf("shapes-initiatives", duties, roles),
      planner: dutyHolderOf("plans", duties, roles),
    });
  const askedTab = tabs && initiativeTabAsked(initiativeThread, tabs);
  const opening = held ?? (tabs && firstInitiativeTab(tabs));
  // The first tab is chosen once: what happens later must not change the tab under the reader.
  const holding = askedTab ?? opening;
  if (holding !== held) setHeld(holding);
  const shown = tabs?.find(({ roleKey }) => roleKey === holding) ?? tabs?.[0];
  if (!tabs || !shown) return null;
  return <PeopleTabs initiative={initiative} tabs={tabs} shown={shown} asked={initiativeThread} />;
}

/**
 * The tabs over the shown person's log and foot. What was seen and unfolded is kept across the
 * tabs, and each tab's To line apart. It stays mounted in a closed drawer, where everything landing
 * counts as out of view.
 */
function PeopleTabs({
  initiative,
  tabs,
  shown,
  asked,
}: {
  readonly initiative: Initiative;
  readonly tabs: readonly InitiativeTab[];
  readonly shown: InitiativeTab;
  /** What the address names: a person's key or a Thread's id. */
  readonly asked: string | undefined;
}): ReactNode {
  const roles = useQuery(roleQueries.list()).data;
  const navigate = useNavigate({ from: "/work/initiatives/$initiativeId" });
  const drawer = useConversationDrawer();
  const outOfSight = drawer.narrow && !drawer.open;
  const [seen, setSeen] = useState<ThreadsSeen>();
  const [folds, setFolds] = useState(NO_FOLDS);
  const [lines, setLines] = useState(NO_LINES);
  const [drafting, setDrafting] = useState(NOBODY_DRAFTING);
  const { roleKey, threads } = shown;
  const chaptered = threads.length > 1;
  const onlyThread = threads.length === 1 ? threads[0] : undefined;
  const askedThreadId = threadAsked(asked, shown);
  const { scroller, chapters, follows, follow } = useTimelineScroll(
    chaptered ? askedThreadId : undefined,
  );
  const allThreads = tabs.flatMap((tab) => tab.threads);
  const newest = threads.at(-1)?.id;
  const placed = threadsSeen(
    seen,
    allThreads.map(({ id }) => id),
    asked,
  );
  // A link followed unfolds its Thread, even one the user folded, and writes there.
  const followed = asked !== undefined && (seen === undefined || seen.asked !== asked);
  const line = lines.get(roleKey);
  const to =
    followed && askedThreadId !== undefined
      ? toLinePicked(askedThreadId, newest)
      : toLineNow(line, newest, drafting.has(roleKey));
  const toId = to.threadId;
  const current =
    toId !== undefined && placed.fresh.has(toId) ? withThreadSeen(placed, toId) : placed;
  // A change in the Threads changes these here, before they are drawn.
  if (current !== seen) setSeen(current);
  if (to !== line) setLines(new Map(lines).set(roleKey, to));
  const started = withChaptersStarted(folds, new Set(toId === undefined ? [] : [toId]));
  const unfolded =
    followed && askedThreadId !== undefined
      ? withChapterOpen(started, askedThreadId, true)
      : started;
  if (unfolded !== folds) setFolds(unfolded);
  const isOpen = (threadId: string): boolean => !chaptered || unfolded.get(threadId) === true;
  const newMessages = useNewMessagesByThread(
    allThreads.map(({ id }) => id),
    (watched) =>
      !outOfSight &&
      threads.some(({ id }) => id === watched) &&
      isOpen(watched) &&
      follows(watched),
  );
  const unseenOf = (threadId: string): number => newMessages.get(threadId)?.count ?? 0;
  const unseenIn = (tab: InitiativeTab): number =>
    tab.threads.reduce((sum, { id }) => sum + unseenOf(id), 0);
  const landedIn = threads.findLast(({ id }) => unseenOf(id) > 0)?.id;

  const roleOf = (tab: InitiativeTab): Role | undefined =>
    tab.unheldLabel === undefined ? roles?.find((each) => each.key === tab.roleKey) : undefined;
  const nameOf = (tab: InitiativeTab): string => roleOf(tab)?.card.name ?? unfilledTabName(tab);
  const role = roleOf(shown);
  const shownName = nameOf(shown);
  const shownLabel = role ? roleName(roleKey, roles) : unfilledTabName(shown);
  const pick = (picked: string): void => {
    void navigate({
      search: (search) => ({ ...search, initiativeThread: picked }),
      replace: true,
      resetScroll: false,
    });
  };
  const toggle = (threadId: string, open: boolean): void => {
    setFolds(withChapterOpen(unfolded, threadId, open));
    if (open) setSeen(withThreadSeen(current, threadId));
    // Folded, the Thread the address names couldn't be reached again by the same link.
    else if (threadId === asked) pick(roleKey);
  };
  const goTo = (threadId: string): void => {
    toggle(threadId, true);
    follow(chaptered && threadId !== newest ? threadId : undefined);
  };
  const choose = (threadId: string): void => {
    setLines(new Map(lines).set(roleKey, toLinePicked(threadId, newest)));
    setFolds(withChapterOpen(unfolded, threadId, true));
    pick(threadId);
  };
  const onDrafting = useCallback(
    (isDrafting: boolean) => setDrafting((before) => withDrafting(before, roleKey, isDrafting)),
    [roleKey],
  );
  const readOnlyReason = ENDED_INITIATIVE_CONVERSATION_WORDS[initiative.state];
  const hired = role?.letGoAt === null ? role : undefined;
  return (
    <ConversationPanel unread={tabs.reduce((sum, tab) => sum + unseenIn(tab), 0)}>
      <div className="conversation-tabs">
        <Tabs
          tabs={tabs.map((tab) => ({
            value: tab.roleKey,
            label: <TabLabel roleKey={tab.roleKey} name={nameOf(tab)} />,
            count: unseenIn(tab) > 0 ? unseenIn(tab) : undefined,
          }))}
          value={roleKey}
          onChange={pick}
        />
        <CloseConversation />
      </div>
      <header className="timeline-head">
        <div className="timeline-head-title">
          <h3>{shownLabel}</h3>
          <p>{initiativeTabLine(shown)}</p>
        </div>
        <DetailsSwitch />
      </header>
      <div className={chaptered ? "timeline-view" : "timeline-view timeline-view-thread"}>
        <div className="timeline" ref={scroller}>
          <div className="timeline-chapters" ref={chapters}>
            <TabThreads key={roleKey} threads={threads} onShown={follow}>
              {onlyThread ? (
                <ChapterLog threadId={onlyThread.id} personName={shownName} />
              ) : chaptered ? (
                threads.map((thread) => (
                  <ThreadChapter
                    key={thread.id}
                    thread={thread}
                    personName={shownName}
                    personLabel={shownLabel}
                    open={isOpen(thread.id)}
                    isNew={current.fresh.has(thread.id)}
                    onToggle={(open) => toggle(thread.id, open)}
                  />
                ))
              ) : (
                <NoThreadYet
                  initiative={initiative}
                  tab={shown}
                  hired={hired}
                  ended={readOnlyReason !== undefined}
                />
              )}
            </TabThreads>
          </div>
        </div>
        {landedIn !== undefined && (
          <div className="timeline-new-messages">
            <Button size="sm" onClick={() => goTo(landedIn)}>
              {newMessagesWords(unseenIn(shown))}
            </Button>
          </div>
        )}
      </div>
      <InitiativeTabFoot
        threads={threads}
        toId={toId}
        personName={shownName}
        personLabel={shownLabel}
        readOnlyReason={readOnlyReason}
        onDrafting={onDrafting}
        onSent={goTo}
        onChoose={choose}
      />
    </ConversationPanel>
  );
}

function withDrafting(
  drafting: ReadonlySet<string>,
  roleKey: string,
  isDrafting: boolean,
): ReadonlySet<string> {
  if (drafting.has(roleKey) === isDrafting) return drafting;
  const next = new Set(drafting);
  if (isDrafting) next.add(roleKey);
  else next.delete(roleKey);
  return next;
}

/** Keyed by person: a tab opens on its newest messages. */
function TabThreads({
  threads,
  onShown,
  children,
}: {
  readonly threads: readonly Thread[];
  readonly onShown: () => void;
  readonly children: ReactNode;
}): ReactNode {
  const hasThreads = threads.length > 0;
  useEffect(() => {
    if (hasThreads) onShown();
  }, [hasThreads, onShown]);
  return children;
}

/**
 * A tab with no Thread: the shaper's offers to start shaping; the planner's offers Plan with… while
 * it is offered, Plan the Initiative being in the head; a duty's while nobody holds it points to
 * Settings › Duties.
 */
function NoThreadYet({
  initiative,
  tab,
  hired,
  ended,
}: {
  readonly initiative: Initiative;
  readonly tab: InitiativeTab;
  /** Whoever fills the Role; undefined while nobody does. */
  readonly hired: Role | undefined;
  readonly ended: boolean;
}): ReactNode {
  const words = emptyInitiativeTabWords({
    tab,
    personName: hired?.card.name,
    initiativeName: initiative.name,
    ended,
  });
  return (
    <EmptyCard>
      {words}
      {tab.duties.includes("shapes-initiatives") && !ended && hired && (
        <StartShaping initiative={initiative} shaper={hired} />
      )}
      {tab.duties.includes("plans") && !ended && hired && (
        <PlanInitiativeWith initiative={initiative} planner={hired.card.name} />
      )}
      {tab.unheldLabel !== undefined && !ended && tab.duties[0] && (
        <DutyUnheldNote duty={tab.duties[0]} />
      )}
    </EmptyCard>
  );
}

function StartShaping({
  initiative,
  shaper,
}: {
  readonly initiative: Initiative;
  readonly shaper: Role;
}): ReactNode {
  const showToast = useToast();
  const starting = useMutation({
    mutationFn: () => startShapingThread(initiative.id),
    onError: (error) => showToast(error.message),
  });
  return (
    <div className="task-conversation-start">
      <Button
        variant="secondary"
        iconLeft={<Icon name="message-circle" size={14} />}
        loading={starting.isPending}
        onClick={() => starting.mutate()}
      >
        Shape it with {shaper.card.name}
      </Button>
    </div>
  );
}

/** One of several Threads of the person's, folded to a line of what the page already has. */
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
  const thread = useQuery(threadQueries.one(threadId));
  return thread.data ? (
    <ThreadLog thread={thread.data} personName={personName} inTimeline />
  ) : (
    <ThreadLoader reads={[thread]} />
  );
}
