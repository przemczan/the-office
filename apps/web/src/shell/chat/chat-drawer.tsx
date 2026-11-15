import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { ChatActivity, Decision, Role, ThreadSummary } from "@the-office/contracts";
import {
  Button,
  EmptyState,
  Icon,
  IconButton,
  SidePanelEdge,
  useCloseOnEscape,
  useOpenedLast,
} from "@the-office/ui";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { markThreadSeen, startChatThread, threadQueries } from "../../api/conversations.ts";
import { rowsOf, totalOf } from "../../api/pages.ts";
import { roleQueries } from "../../api/people.ts";
import { MentionedDecisionWindow } from "../conversation/decision-on-task.tsx";
import { ThreadView } from "../conversation/thread-view.tsx";
import { PersonAvatar } from "../person-avatar.tsx";
import { OpenMentionedDecisionContext } from "../record-mention.tsx";
import { RefusalAlert } from "../refusal-alert.tsx";
import { ShowMore } from "../show-more.tsx";
import { dayAndClockOf } from "../time.ts";
import { useClosedFromOutside } from "../use-closed-from-outside.ts";
import { useTabVisible } from "../use-tab-visible.ts";
import { CHAT_BUTTON_ELEMENT_ID } from "./chat-button.tsx";
import {
  CHAT_DRAWER_WIDTHS,
  rememberChatDrawerWidth,
  showChatDrawerWidth,
  useChatDrawerLayout,
} from "./chat-drawer-width.ts";
import { StandingDot, StandingWords } from "./chat-standing.tsx";
import { ChatTabs } from "./chat-tabs.tsx";
import { chatStanding } from "./chat-words.ts";
import { useChatPeople } from "./use-chat-people.ts";
import { useChat, useChatOpenPage } from "./use-chat.tsx";
import "./chat.css";

/**
 * A person's chat, a side panel beside any page (spec §4): the person picker, a person's Threads, or
 * the one open. Not a window: the page stays usable, and it stays open as the user moves about.
 */
export function ChatDrawer(): ReactNode {
  const chat = useChat();
  const layout = useChatDrawerLayout();
  const frame = useRef<HTMLElement>(null);
  const queryClient = useQueryClient();
  const role = useQuery({
    ...roleQueries.one(chat.roleKey ?? ""),
    enabled: !!chat.roleKey,
    // A tab's person is in the hired people's list, so switching tabs never empties the drawer.
    placeholderData: () =>
      queryClient
        .getQueryData(roleQueries.list().queryKey)
        ?.find(({ key }) => key === chat.roleKey),
  });
  useCloseOnEscape(chat.isOpen, chat.close, frame, "side-panel");
  const openedLast = useOpenedLast(frame);
  useDrawerFocus(chat.isOpen, frame);
  const [mentionedDecision, setMentionedDecision] = useState<Decision>();
  if (!chat.isOpen) return null;
  const person = chat.roleKey ? role.data : undefined;
  return (
    <aside
      ref={frame}
      className={`chat-drawer ${layout.place}${openedLast ? " opened-last" : ""}`}
      aria-label={person ? `Chat with ${person.card.name}` : "Chat"}
      tabIndex={-1}
    >
      {layout.place !== "fills" && (
        <SidePanelEdge
          label="Resize the chat"
          width={layout.width}
          least={CHAT_DRAWER_WIDTHS.least}
          most={layout.most}
          standard={CHAT_DRAWER_WIDTHS.standard}
          onResize={showChatDrawerWidth}
          onResized={rememberChatDrawerWidth}
        />
      )}
      {person ? (
        <OpenMentionedDecisionContext value={setMentionedDecision}>
          <PersonHead role={person} />
          <PersonTabs />
          <PersonChat key={person.key} role={person} />
        </OpenMentionedDecisionContext>
      ) : (
        (!chat.roleKey || role.isError) && <PersonPicker />
      )}
      {mentionedDecision && (
        <MentionedDecisionWindow
          decision={mentionedDecision}
          onClose={() => setMentionedDecision(undefined)}
        />
      )}
    </aside>
  );
}

/**
 * Opening moves focus into the drawer, where a Thread's composer takes it. Closing gives it back to
 * the Chat button, unless what closed the drawer has already taken it elsewhere.
 */
function useDrawerFocus(open: boolean, frame: RefObject<HTMLElement | null>): void {
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open === wasOpen.current) return;
    wasOpen.current = open;
    if (open) frame.current?.focus();
    else if (document.activeElement === document.body) {
      document.getElementById(CHAT_BUTTON_ELEMENT_ID)?.focus();
    }
  }, [open, frame]);
}

function CloseButton(): ReactNode {
  const chat = useChat();
  return <IconButton icon={<Icon name="x" size={16} />} label="Close (Esc)" onClick={chat.close} />;
}

/** With no chat open yet: the people with chat on, in one fixed order. */
function PersonPicker(): ReactNode {
  const chat = useChat();
  const people = useChatPeople();
  return (
    <>
      <header className="chat-head">
        <div className="chat-head-main">
          <span className="chat-head-title">Chat</span>
          <span className="chat-head-sub">Pick a person to talk to</span>
        </div>
        <CloseButton />
      </header>
      <div className="chat-people">
        {people.map(({ role, activity }) => (
          <button
            key={role.key}
            type="button"
            className="chat-person"
            onClick={() => chat.open(role.key)}
          >
            <span aria-hidden="true">
              <PersonAvatar roleKey={role.key} name={role.card.name} size="lg" />
            </span>
            <span className="chat-person-who">
              <b>{role.card.name}</b>
              <span>{role.card.title}</span>
            </span>
            <StandingWords standing={chatStanding(activity)} />
          </button>
        ))}
        <p className="chat-people-note">
          People with chat off aren't listed. Chat is turned on in a person's Role card.
        </p>
      </div>
    </>
  );
}

/** The person's name is the switch to someone else, with the drawer staying open. */
function PersonHead({ role }: { readonly role: Role }): ReactNode {
  const [switching, setSwitching] = useState(false);
  const place = useClosedFromOutside(switching, setSwitching);
  return (
    <header className="chat-head">
      <PersonAvatar roleKey={role.key} name={role.card.name} size="lg" />
      <div ref={place} className="chat-head-main">
        <button
          type="button"
          className="person-switch"
          aria-haspopup="menu"
          aria-expanded={switching}
          title="Chat with someone else"
          onClick={() => setSwitching(!switching)}
        >
          <span className="person-switch-name">{role.card.name}</span>
          <span className="person-switch-title">{role.card.title}</span>
          <Icon name="chevron-down" size={14} />
        </button>
        {/* The Caretaker's chat changes the workstation in a Thread with Allow changes on. */}
        <span className="chat-head-sub">
          {role.builtIn
            ? "Reads, and changes only in a Thread where you allow changes"
            : "Reads every Project and changes no file"}
        </span>
        {switching && <PersonSwitchMenu role={role} onDone={() => setSwitching(false)} />}
      </div>
      <CloseButton />
    </header>
  );
}

/** The people open in the drawer, to switch between without the person switch. */
function PersonTabs(): ReactNode {
  const chat = useChat();
  const people = useChatPeople();
  return (
    <ChatTabs
      tabs={chat.tabs}
      shown={chat.roleKey}
      people={people}
      onShow={(roleKey) => chat.open(roleKey)}
      onClose={chat.closeTab}
    />
  );
}

function PersonSwitchMenu({
  role,
  onDone,
}: {
  readonly role: Role;
  readonly onDone: () => void;
}): ReactNode {
  const chat = useChat();
  const people = useChatPeople();
  return (
    <div className="person-switch-menu" role="menu" aria-label="Chat with">
      {people.map(({ role: person, activity }) => {
        const standing = chatStanding(activity);
        return (
          <button
            key={person.key}
            type="button"
            className="person-switch-item"
            role="menuitemradio"
            aria-checked={person.key === role.key}
            title={standing.words}
            onClick={() => {
              onDone();
              chat.open(person.key);
            }}
          >
            <span aria-hidden="true">
              <PersonAvatar roleKey={person.key} name={person.card.name} size="sm" />
            </span>
            <span className="chat-person-who">
              <b>{person.card.name}</b>
              <span>{person.card.title}</span>
            </span>
            <StandingDot standing={standing} />
          </button>
        );
      })}
      <div className="person-switch-foot">
        Open{" "}
        <Link to="/people/$roleKey" params={{ roleKey: role.key }} search={{}} onClick={onDone}>
          {role.card.name}'s page
        </Link>{" "}
        for their Role card and Memory.
      </div>
    </div>
  );
}

/**
 * One column: the open Thread fills the drawer, and the Thread list, read a page at a time, is a
 * step back from it. The open Thread is read in full by its id, so one past the pages read opens
 * as well.
 */
function PersonChat({ role }: { readonly role: Role }): ReactNode {
  const chat = useChat();
  const threads = useInfiniteQuery(threadQueries.inChat(role.key));
  const activity = useQuery(threadQueries.chatActivity());
  const queryClient = useQueryClient();
  const starting = useMutation({
    mutationFn: () => startChatThread(role.key),
    onSuccess: async (thread) => {
      queryClient.setQueryData(threadQueries.one(thread.id).queryKey, thread);
      await queryClient.invalidateQueries(threadQueries.inChat(role.key));
      chat.showThread(thread.id);
    },
  });
  const list = rowsOf(threads.data);
  const current = chat.threadId ?? list[0]?.id;
  const showingList = chat.onThreadList || current === undefined;
  // From here on the drawer stays on this Thread, whatever starts in the chat meanwhile.
  const shownId = showingList ? undefined : current;
  useEffect(() => {
    if (shownId !== undefined && chat.threadId === undefined) chat.showThread(shownId);
  }, [shownId, chat]);
  if (!threads.data) return null;
  const refusal = starting.error && <RefusalAlert title="No new Thread" error={starting.error} />;
  const newThread = (
    <Button
      variant="secondary"
      iconLeft={<Icon name="plus" size={14} />}
      loading={starting.isPending}
      onClick={() => starting.mutate()}
    >
      New thread
    </Button>
  );
  if (shownId === undefined) {
    return (
      <div className="chat-threads">
        {refusal}
        {list.length === 0 ? (
          <EmptyState
            icon="message-circle"
            title={`No threads with ${role.card.name} yet.`}
            description="A new Thread starts a session that reads every Project's base branch."
            action={newThread}
          />
        ) : (
          <>
            <ThreadList
              threads={list}
              total={totalOf(threads.data)}
              current={current}
              newThread={newThread}
              onOpen={chat.showThread}
            />
            <ShowMore list={threads} />
          </>
        )}
      </div>
    );
  }
  return (
    <div className="chat-main">
      {refusal && <div className="chat-main-refusal">{refusal}</div>}
      <ShownThread
        key={shownId}
        threadId={shownId}
        personName={role.card.name}
        othersAnswered={answeredElsewhere(activity.data, role.key, shownId)}
        newThread={
          <IconButton
            icon={<Icon name="plus" size={14} />}
            label="New thread"
            size="sm"
            disabled={starting.isPending}
            aria-busy={starting.isPending}
            onClick={() => starting.mutate()}
          />
        }
      />
    </div>
  );
}

/** Whether another of the person's chat Threads has an answer the user hasn't seen. */
function answeredElsewhere(
  activity: ChatActivity | undefined,
  roleKey: string,
  threadId: string,
): boolean {
  const theirs = activity?.find((person) => person.roleKey === roleKey);
  return theirs?.answered.some((answered) => answered.threadId !== threadId) ?? false;
}

function ThreadList({
  threads,
  total,
  current,
  newThread,
  onOpen,
}: {
  readonly threads: readonly ThreadSummary[];
  /** Every Thread in the chat, of which `threads` are the pages read so far. */
  readonly total: number;
  readonly current: string | undefined;
  readonly newThread: ReactNode;
  readonly onOpen: (threadId: string) => void;
}): ReactNode {
  return (
    <>
      {newThread}
      <div className="chat-threads-count">Threads · {total}</div>
      {threads.map((thread) => (
        <ThreadItem
          key={thread.id}
          thread={thread}
          active={thread.id === current}
          onOpen={() => onOpen(thread.id)}
        />
      ))}
    </>
  );
}

function ThreadItem({
  thread,
  active,
  onOpen,
}: {
  readonly thread: ThreadSummary;
  readonly active: boolean;
  readonly onOpen: () => void;
}): ReactNode {
  const warm = thread.context.cacheWarm;
  const answered = thread.answered === true;
  return (
    <button
      type="button"
      className={`chat-thread${active ? " active" : ""}${answered ? " has-answer" : ""}`}
      aria-current={active}
      onClick={onOpen}
    >
      <span className="chat-thread-title">
        <span>{thread.title ?? "New thread"}</span>
        {answered && <span className="chat-dot answered" />}
      </span>
      <span className="chat-thread-sub">
        <span
          className={warm ? "context-dot warm" : "context-dot"}
          title={warm ? "Cache warm" : "Starts fresh with a brief, or continues a small context"}
        />
        {dayAndClockOf(thread.lastMovedAt ?? thread.startedAt)}
        {thread.state === "answering" && (
          <>
            {" · "}
            <span className="chat-standing answering">
              <span className="chat-dot answering" />
              answering
            </span>
          </>
        )}
        {answered && (
          <>
            {" · "}
            <span className="chat-standing answered">answered</span>
          </>
        )}
      </span>
    </button>
  );
}

function ShownThread({
  threadId,
  personName,
  othersAnswered,
  newThread,
}: {
  readonly threadId: string;
  readonly personName: string;
  readonly othersAnswered: boolean;
  /** Starts another Thread with the same person, beside the way back to the list. */
  readonly newThread: ReactNode;
}): ReactNode {
  const chat = useChat();
  const openPage = useChatOpenPage();
  useReportingSeen(threadId);
  return (
    <ThreadView
      threadId={threadId}
      personName={personName}
      openPage={openPage.page}
      onLeaveOutOpenPage={openPage.leaveOut}
      back={
        <>
          <button
            type="button"
            className="chat-back"
            title={`Every Thread with ${personName}`}
            onClick={chat.showThreadList}
          >
            <Icon name="chevron-left" size={14} />
            Threads
            {othersAnswered && <span className="chat-dot answered" />}
          </button>
          {newThread}
        </>
      }
    />
  );
}

/**
 * Tells the service the newest message on screen, so what the user has seen holds in every browser
 * (spec §2.4). A hidden tab tells it nothing until the user comes back to it.
 */
function useReportingSeen(threadId: string): void {
  const messages = useQuery(threadQueries.messages(threadId));
  const visible = useTabVisible();
  const newest = messages.data?.at(-1)?.id;
  const reported = useRef<string>(undefined);
  useEffect(() => {
    if (!visible || newest === undefined || newest === reported.current) return;
    reported.current = newest;
    // A report that fails only leaves the dot on, until the next message or the next look.
    markThreadSeen(threadId, newest).catch(() => {
      reported.current = undefined;
    });
  }, [threadId, newest, visible]);
}
