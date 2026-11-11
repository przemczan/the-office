import {
  threadWebEventSchema,
  type Message,
  type OutputChunk,
  type Process,
  type SubAgent,
  type SubAgentMessage,
  type SubAgentOrProcess,
  type WebEvent,
} from "@the-office/contracts";
import { Badge, Button, Icon, TextButton, type BadgeProps } from "@the-office/ui";
import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { readProcessOutput, readSubAgentMessages } from "../../api/conversations.ts";
import { DetailsSwitch } from "../conversation/details-switch.tsx";
import { useDetails } from "../conversation/details-store.ts";
import { MessageList } from "../conversation/message-list.tsx";
import { MarkdownText } from "../markdown-text.tsx";
import { RefusalAlert } from "../refusal-alert.tsx";
import { useClock } from "../use-clock.ts";
import {
  earlierMessagesWords,
  earlierOutputWords,
  endingStrip,
  factWords,
  itemTitle,
  kindWords,
  listGroups,
  ranFor,
  ranWords,
  STATE_WORDS,
  startedByWords,
  stateWords,
} from "./sub-agents-and-processes-words.ts";
import { useCaughtUpStream } from "./use-caught-up.ts";
import { useSubAgentsAndProcesses } from "./use-sub-agents-and-processes.ts";
import "./sub-agents-and-processes.css";

/** How near the end of the output a reader counts as following it. */
const FOLLOWING_DISTANCE_PX = 24;

/** A prompt longer than about three lines folds, with Read it in full. */
const PROMPT_FOLDS_AT_LINES = 3.2;
const PROMPT_CHARACTERS_A_LINE = 90;

/**
 * A session's Sub-agents and Processes (spec 2.9): the list and the details of the one picked,
 * side by side, stacked with a way back to the list where the view is under 640px wide (its
 * container query). Read-only: nothing here stops anything. The window holds it, and the Stage
 * history holds it as a run's tab.
 */
export function SubAgentsAndProcessesView({
  threadId,
  personName,
}: {
  readonly threadId: string;
  /** Whose session it is: the Agent that started what has no other starter. */
  readonly personName: string;
}): ReactNode {
  const items = useSubAgentsAndProcesses(threadId) ?? [];
  const now = useClock(1000);
  const [pickedId, setPickedId] = useState<string | undefined>(undefined);
  const [pane, setPane] = useState<"list" | "details">("list");
  const { running, ended } = listGroups(items);
  const picked = items.find(({ callId }) => callId === pickedId) ?? running.at(0) ?? ended.at(0);
  // What shows stays picked, so the details don't move to the next one running as it ends.
  if (picked !== undefined && picked.callId !== pickedId) setPickedId(picked.callId);
  const pick = (callId: string): void => {
    setPickedId(callId);
    setPane("details");
  };
  return (
    <div className="sub-agents-and-processes" data-pane={pane}>
      <div className="sub-agents-and-processes-body">
        <nav className="sub-agents-and-processes-list" aria-label="Sub-agents and processes">
          <ListGroup title="Running" items={running} picked={picked} now={now} onPick={pick} />
          <ListGroup title="Ended" items={ended} picked={picked} now={now} onPick={pick} />
        </nav>
        {picked && (
          <section className="sub-agents-and-processes-details" aria-label={itemTitle(picked)}>
            <button
              type="button"
              className="sub-agents-and-processes-back"
              onClick={() => setPane("list")}
            >
              <Icon name="chevron-left" size={14} />
              All sub-agents and processes
            </button>
            {picked.kind === "process" ? (
              <ProcessDetails
                key={picked.callId}
                threadId={threadId}
                shownProcess={picked}
                items={items}
                personName={personName}
                now={now}
              />
            ) : (
              <SubAgentDetails
                key={picked.callId}
                threadId={threadId}
                subAgent={picked}
                items={items}
                personName={personName}
                now={now}
              />
            )}
          </section>
        )}
      </div>
    </div>
  );
}

function ListGroup({
  title,
  items,
  picked,
  now,
  onPick,
}: {
  readonly title: string;
  readonly items: readonly SubAgentOrProcess[];
  readonly picked: SubAgentOrProcess | undefined;
  readonly now: Date;
  readonly onPick: (callId: string) => void;
}): ReactNode {
  if (items.length === 0) return null;
  return (
    <div className="sub-agents-and-processes-group" role="group" aria-label={title}>
      <p className="sub-agents-and-processes-group-head">
        <span className="overline">{title}</span>
        <Badge size="sm">{items.length}</Badge>
      </p>
      <ul>
        {items.map((item) => (
          <li key={item.callId}>
            <ListItem item={item} isPicked={item === picked} now={now} onPick={onPick} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A mark for its kind, its description or command, then its kind, state and how long it ran. */
function ListItem({
  item,
  isPicked,
  now,
  onPick,
}: {
  readonly item: SubAgentOrProcess;
  readonly isPicked: boolean;
  readonly now: Date;
  readonly onPick: (callId: string) => void;
}): ReactNode {
  const showsCommand = item.kind === "process" && item.description === "";
  return (
    <button
      type="button"
      className="sub-agents-and-processes-item"
      aria-current={isPicked}
      onClick={() => onPick(item.callId)}
    >
      <span className="sub-agents-and-processes-item-mark" aria-hidden="true">
        <KindIcon item={item} size={15} />
      </span>
      <span
        className={
          showsCommand
            ? "sub-agents-and-processes-item-title command"
            : "sub-agents-and-processes-item-title"
        }
      >
        {itemTitle(item)}
      </span>
      <span className="sub-agents-and-processes-item-meta">
        <span>{kindWords(item)}</span>
        {/* The gap draws the spaces; the words keep them for whoever reads them out. */}
        <span> · </span>
        <span className={`sub-agents-and-processes-state ${item.state}`}>
          {item.state === "running" && <span className="live-dot" aria-hidden="true" />}
          {item.state === "finished" && <Icon name="check" size={11} />}
          {stateWords(item)}
        </span>
        <span> · </span>
        <span>{ranWords(ranFor(item, now))}</span>
      </span>
    </button>
  );
}

function KindIcon({
  item,
  size,
}: {
  readonly item: SubAgentOrProcess;
  readonly size: number;
}): ReactNode {
  return <Icon name={item.kind === "process" ? "terminal" : "bot"} size={size} />;
}

const STATE_TONES: Readonly<Record<SubAgentOrProcess["state"], BadgeProps["tone"]>> = {
  running: "success",
  finished: "neutral",
  failed: "danger",
  stopped: "neutral",
};

/** Its title, its badges and its facts. */
function DetailsHead({
  item,
  items,
  personName,
  now,
}: {
  readonly item: SubAgentOrProcess;
  readonly items: readonly SubAgentOrProcess[];
  readonly personName: string;
  readonly now: Date;
}): ReactNode {
  return (
    <header className="sub-agents-and-processes-head">
      <h3 className="sub-agents-and-processes-title">
        <KindIcon item={item} size={16} />
        <span>{itemTitle(item)}</span>
      </h3>
      <div className="sub-agents-and-processes-badges">
        <Badge tone={STATE_TONES[item.state]} dot={item.state === "running"}>
          {STATE_WORDS[item.state]}
        </Badge>
        {item.kind === "sub-agent" && item.agentKind !== null && <Badge>{item.agentKind}</Badge>}
        {item.kind === "sub-agent" && item.background && (
          <Badge tone="info">In the background</Badge>
        )}
      </div>
      <p className="sub-agents-and-processes-facts">
        {factWords(item, items, personName, now).map((fact) => (
          <span key={fact}>{fact}</span>
        ))}
      </p>
    </header>
  );
}

function EndingStrip({ item }: { readonly item: SubAgentOrProcess }): ReactNode {
  const strip = endingStrip(item);
  if (strip === undefined) return null;
  const icon = { finished: "check", failed: "circle-alert", stopped: "circle-stop" }[strip.tone];
  return (
    <p className={`sub-agents-and-processes-ending ${strip.tone}`}>
      <Icon name={icon} size={14} />
      <span>{strip.words}</span>
    </p>
  );
}

function TryAgain({ onPress }: { readonly onPress: () => void }): ReactNode {
  return (
    <Button variant="secondary" size="sm" onClick={onPress}>
      Try again
    </Button>
  );
}

/**
 * A Process: its command whole, then its output in monospace, following the end while it runs
 * until the reader scrolls up, then Jump to the end. Only the output scrolls.
 */
function ProcessDetails({
  threadId,
  shownProcess,
  items,
  personName,
  now,
}: {
  readonly threadId: string;
  readonly shownProcess: Process;
  readonly items: readonly SubAgentOrProcess[];
  readonly personName: string;
  readonly now: Date;
}): ReactNode {
  const { callId } = shownProcess;
  const output = useCaughtUpStream({
    threadId,
    eventType: "thread.process-output",
    partsOf: (event) => outputOf(event, callId),
    read: async (after, signal) => {
      const read = await readProcessOutput(threadId, callId, after, signal);
      return {
        parts: read.chunks,
        lastSequence: read.lastSequence,
        earlierNotKept: read.earlierNotKept,
      };
    },
  });
  const outputBox = useRef<HTMLPreElement>(null);
  const [following, setFollowing] = useState(true);
  const text = output.parts.map((chunk) => chunk.text).join("");
  useLayoutEffect(() => {
    const box = outputBox.current;
    // Each new chunk scrolls to the end while the reader follows it; no output has none to follow.
    if (!following || text === "" || box === null) return;
    box.scrollTop = box.scrollHeight;
  }, [following, text]);
  const jumpToTheEnd = useCallback((): void => setFollowing(true), []);
  const running = shownProcess.state === "running";
  const dropped = earlierOutputWords(output.earlierNotKept ?? shownProcess.earlierOutputNotKept);
  return (
    <div className="sub-agents-and-processes-scroll process">
      <DetailsHead item={shownProcess} items={items} personName={personName} now={now} />
      <div className="sub-agents-and-processes-section">
        <span className="overline">Command</span>
        <pre className="sub-agents-and-processes-command">{shownProcess.commandLine}</pre>
      </div>
      <div className="sub-agents-and-processes-section output">
        <div className="sub-agents-and-processes-section-row">
          <span className="overline">Output</span>
          {running &&
            (following ? (
              <span className="sub-agents-and-processes-following">
                <span className="live-dot" aria-hidden="true" />
                Following the end
              </span>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                iconLeft={<Icon name="arrow-down" size={12} />}
                onClick={jumpToTheEnd}
              >
                Jump to the end
              </Button>
            ))}
        </div>
        {output.error !== null && (
          <RefusalAlert
            title="The output wasn't read"
            error={output.error}
            action={<TryAgain onPress={output.readAgain} />}
          />
        )}
        <pre
          ref={outputBox}
          className="sub-agents-and-processes-output"
          tabIndex={0}
          aria-label="Output"
          onScroll={({ currentTarget: { scrollHeight, scrollTop, clientHeight } }) =>
            setFollowing(scrollHeight - scrollTop - clientHeight <= FOLLOWING_DISTANCE_PX)
          }
        >
          {dropped !== undefined && (
            <span className="sub-agents-and-processes-dropped">{dropped}</span>
          )}
          {output.earlierNotKept === undefined ? (
            <span className="sub-agents-and-processes-quiet" role="status">
              Reading the output…
            </span>
          ) : text === "" ? (
            <span className="sub-agents-and-processes-quiet">
              {running ? "Nothing printed yet." : "Printed nothing."}
            </span>
          ) : (
            text
          )}
        </pre>
        <EndingStrip item={shownProcess} />
      </div>
    </div>
  );
}

/** The Process's own chunk an event carries. */
function outputOf(event: WebEvent, callId: string): readonly OutputChunk[] {
  const parsed = threadWebEventSchema.safeParse(event);
  if (!parsed.success || parsed.data.type !== "thread.process-output") return [];
  return parsed.data.callId === callId ? [parsed.data.chunk] : [];
}

/**
 * A Sub-agent: its prompt's first lines with Read it in full, its messages and tool calls in Rows
 * as a Thread shows its Agent's, with the Details switch on their row, then, once ended, what it
 * reported back or how it failed.
 */
function SubAgentDetails({
  threadId,
  subAgent,
  items,
  personName,
  now,
}: {
  readonly threadId: string;
  readonly subAgent: SubAgent;
  readonly items: readonly SubAgentOrProcess[];
  readonly personName: string;
  readonly now: Date;
}): ReactNode {
  const { callId } = subAgent;
  const messages = useCaughtUpStream({
    threadId,
    eventType: "thread.sub-agent-messages",
    partsOf: (event) => messagesOf(event, callId),
    read: async (after, signal) => {
      const read = await readSubAgentMessages(threadId, callId, after, signal);
      return {
        parts: read.messages,
        lastSequence: read.lastSequence,
        earlierNotKept: read.earlierNotKept,
      };
    },
  });
  const details = useDetails();
  const [promptOpen, setPromptOpen] = useState(false);
  const promptFolds =
    !promptOpen &&
    subAgent.prompt.split("\n").length + subAgent.prompt.length / PROMPT_CHARACTERS_A_LINE >
      PROMPT_FOLDS_AT_LINES;
  const name = subAgent.agentKind === null ? "Sub-agent" : `${subAgent.agentKind} sub-agent`;
  const dropped = earlierMessagesWords(messages.earlierNotKept ?? subAgent.earlierMessagesNotKept);
  return (
    <div className="sub-agents-and-processes-scroll">
      <DetailsHead item={subAgent} items={items} personName={personName} now={now} />
      <div className="sub-agents-and-processes-section">
        <span className="overline">Its prompt</span>
        <p
          className={
            promptFolds
              ? "sub-agents-and-processes-prompt folded"
              : "sub-agents-and-processes-prompt"
          }
        >
          {subAgent.prompt}
        </p>
        {promptFolds && (
          <div>
            <TextButton onClick={() => setPromptOpen(true)}>Read it in full</TextButton>
          </div>
        )}
      </div>
      <div className="sub-agents-and-processes-section">
        <div className="sub-agents-and-processes-section-row">
          <span className="overline">Messages and tool calls</span>
          <DetailsSwitch />
        </div>
        {dropped !== undefined && <p className="sub-agents-and-processes-quiet">{dropped}</p>}
        {messages.error !== null && (
          <RefusalAlert
            title="The messages weren't read"
            error={messages.error}
            action={<TryAgain onPress={messages.readAgain} />}
          />
        )}
      </div>
      <div className="sub-agents-and-processes-messages">
        <MessageList
          messages={messages.parts.map((message) => threadMessageOf(message, callId))}
          roleKey={SUB_AGENT_ROLE_KEY}
          personName={name}
          answering={subAgent.state === "running"}
          stageThread={false}
          details={details.on}
          inTimeline
        />
        {subAgent.state !== "running" && subAgent.reportedBack !== null && (
          <section className="sub-agents-and-processes-reported" aria-label="Reported back">
            <p className="sub-agents-and-processes-reported-head">
              Reported back to {startedByWords(subAgent, items, personName)}
            </p>
            <MarkdownText text={subAgent.reportedBack} />
          </section>
        )}
        <EndingStrip item={subAgent} />
      </div>
    </div>
  );
}

/** No Role has it, so a Sub-agent's turns show its initials, never a person's picture. */
const SUB_AGENT_ROLE_KEY = "sub-agent";

/** The Sub-agent's own messages an event carries. */
function messagesOf(event: WebEvent, callId: string): readonly SubAgentMessage[] {
  const parsed = threadWebEventSchema.safeParse(event);
  if (!parsed.success || parsed.data.type !== "thread.sub-agent-messages") return [];
  return parsed.data.callId === callId ? parsed.data.messages : [];
}

/** A Sub-agent's message in the Thread's own shape, so the Thread's Rows draw it. */
function threadMessageOf(message: SubAgentMessage, callId: string): Message {
  const fields = {
    id: `${callId}/${message.sequence}`,
    at: message.at,
    roleKey: SUB_AGENT_ROLE_KEY,
  };
  switch (message.kind) {
    case "text":
      return { ...fields, kind: "person", text: message.text };
    case "tool-activity":
      return { ...fields, kind: "tool-activity", tool: message.tool, summary: message.summary };
    case "refusal":
      return { ...fields, kind: "refusal", tool: message.tool, reason: message.reason };
  }
}
