import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { Decision, Role, Thread } from "@the-office/contracts";
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
import { roleQueries } from "../../api/people.ts";
import { MentionedDecisionWindow } from "../conversation/decision-on-task.tsx";
import { ThreadView } from "../conversation/thread-view.tsx";
import { PersonAvatar } from "../person-avatar.tsx";
import { OpenMentionedDecisionContext } from "../record-mention.tsx";
import { RefusalAlert } from "../refusal-alert.tsx";
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
import { chatStanding, type ChatStanding } from "./chat-words.ts";
import { useChatPeople } from "./use-chat-people.ts";
import { useChat } from "./use-chat.tsx";
import "./chat.css";

/**
 * A person's chat, a side panel beside any page (spec §4): the person picker, a person's Threads, or
 * the one open. Not a window: the page stays usable, and it stays open as the user moves about.
 */
export function ChatDrawer(): ReactNode {
  const chat = useChat();
  const layout = useChatDrawerLayout();
  const frame = useRef<HTMLElement>(null);
  const role = useQuery({ ...roleQueries.one(chat.roleKey ?? ""), enabled: !!chat.roleKey });
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

function StandingWords({ standing }: { readonly standing: ChatStanding }): ReactNode {
  return (
    <span className={`chat-standing ${standing.kind}`}>
      <StandingDot standing={standing} />
      {standing.words}
    </span>
  );
}

function StandingDot({ standing: { kind } }: { readonly standing: ChatStanding }): ReactNode {
  return kind === "answered" || kind === "answering" ? (
    <span className={`chat-dot ${kind}`} />
  ) : null;
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

/** One column: the open Thread fills the drawer, and the Thread list is a step back from it. */
function PersonChat({ role }: { readonly role: Role }): ReactNode {
  const chat = useChat();
  const threads = useQuery(threadQueries.inChat(role.key));
  const queryClient = useQueryClient();
  const starting = useMutation({
    mutationFn: () => startChatThread(role.key),
    onSuccess: async (thread) => {
      queryClient.setQueryData(threadQueries.one(thread.id).queryKey, thread);
      await queryClient.invalidateQueries(threadQueries.inChat(role.key));
      chat.showThread(thread.id);
    },
  });
  const list = threads.data ?? [];
  const shown = list.find(({ id }) => id === chat.threadId) ?? list[0];
  const showingList = chat.onThreadList || shown === undefined;
  // From here on the drawer stays on this Thread, whatever starts in the chat meanwhile.
  const shownId = showingList ? undefined : shown.id;
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
  if (showingList) {
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
          <ThreadList
            threads={list}
            current={shown?.id}
            newThread={newThread}
            onOpen={chat.showThread}
          />
        )}
      </div>
    );
  }
  return (
    <div className="chat-main">
      <ShownThread
        key={shown.id}
        thread={shown}
        personName={role.card.name}
        othersAnswered={list.some(({ id, answered }) => id !== shown.id && answered === true)}
      />
    </div>
  );
}

function ThreadList({
  threads,
  current,
  newThread,
  onOpen,
}: {
  readonly threads: readonly Thread[];
  readonly current: string | undefined;
  readonly newThread: ReactNode;
  readonly onOpen: (threadId: string) => void;
}): ReactNode {
  return (
    <>
      {newThread}
      <div className="chat-threads-count">Threads · {threads.length}</div>
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
  readonly thread: Thread;
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
  thread,
  personName,
  othersAnswered,
}: {
  readonly thread: Thread;
  readonly personName: string;
  readonly othersAnswered: boolean;
}): ReactNode {
  const chat = useChat();
  useReportingSeen(thread.id);
  return (
    <ThreadView
      threadId={thread.id}
      personName={personName}
      back={
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
