import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { countedTokens, type Role, type StageRun, type TaskStage } from "@the-office/contracts";
import { Badge, Button, Icon, Tabs } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { threadQueries } from "../../api/conversations.ts";
import { pipelineQueries } from "../../api/pipelines.ts";
import { attachmentQueries } from "../../api/work.ts";
import { AttachmentGallery } from "../../shell/attachments/attachment-gallery.tsx";
import { attachmentsOfGateRun, oneRound } from "../../shell/attachments/attachment-rounds.ts";
import { ContextReading, SessionRow } from "../../shell/conversation/context-reading.tsx";
import { endedRunReadingLook } from "../../shell/conversation/context-reading-words.ts";
import { DetailsSwitch } from "../../shell/conversation/details-switch.tsx";
import { ReadOnlyNote, ThreadComposer } from "../../shell/conversation/thread-composer.tsx";
import { ThreadLog } from "../../shell/conversation/thread-view.tsx";
import { takesMessages } from "../../shell/conversation/thread-writing.ts";
import { MarkdownText } from "../../shell/markdown-text.tsx";
import { PersonAvatar } from "../../shell/person-avatar.tsx";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import { SubAgentsAndProcessesLine } from "../../shell/sub-agents-and-processes/sub-agents-and-processes-line.tsx";
import { SubAgentsAndProcessesView } from "../../shell/sub-agents-and-processes/sub-agents-and-processes-view.tsx";
import { useSubAgentsAndProcesses } from "../../shell/sub-agents-and-processes/use-sub-agents-and-processes.ts";
import { TokenFigure } from "../../shell/token-count.tsx";
import { NEEDS_YOU_ELEMENT_ID } from "./needs-you-words.ts";
import { bringIntoView } from "./record-blocks.ts";
import {
  carriedFailureWords,
  commandMarkWords,
  commandTimeWords,
  gateChoiceWords,
  runBadge,
  runOfHandoverNote,
  runResultText,
  runThreadClosedWords,
  runTimeWords,
  type RunPlace,
  type RunTab,
} from "./stage-history-words.ts";
import { stageWorkerWords } from "./stage-rail-words.ts";
import { SESSION_WORDS, type StageNames } from "./stage-words.ts";
import { chapterWork } from "./timeline-words.ts";

/** Everything about the run picked in the Stage history. */
export function RunDetails({
  taskId,
  stages,
  taskStage,
  run,
  tab,
  roles,
  names,
  now,
  onTab,
  onReadSummary,
  onClose,
}: {
  readonly taskId: string;
  readonly stages: readonly TaskStage[];
  readonly taskStage: TaskStage;
  readonly run: StageRun;
  readonly tab: RunTab;
  readonly roles: readonly Role[] | undefined;
  readonly names: StageNames;
  readonly now: Date;
  readonly onTab: (tab: RunTab) => void;
  readonly onReadSummary: (run: RunPlace) => void;
  readonly onClose: () => void;
}): ReactNode {
  const { stage } = taskStage;
  const summary = (
    <RunSummary taskStage={taskStage} run={run} roles={roles} names={names} onClose={onClose} />
  );
  const head = <RunHead taskStage={taskStage} run={run} now={now} />;
  if (stage.kind !== "agent" || run.threadId === null) {
    return (
      <section className="run-details" aria-label={`Run ${run.number}`}>
        {head}
        <div className="run-details-body">
          {summary}
          {stage.kind === "script" && <CommandLog taskId={taskId} run={run} />}
          {stage.kind === "gate" && (
            <GateRunAttachments key={run.id} taskId={taskId} stages={stages} run={run} />
          )}
        </div>
      </section>
    );
  }
  return (
    <AgentRunDetails
      threadId={run.threadId}
      stages={stages}
      taskStage={taskStage}
      run={run}
      tab={tab}
      personName={stageWorkerWords(taskStage, roles)}
      head={head}
      summary={summary}
      onTab={onTab}
      onReadSummary={onReadSummary}
    />
  );
}

const SUB_AGENTS_AND_PROCESSES = "sub-agents-and-processes";

/**
 * An Agent run's Summary and Thread, and its Sub-agents and processes once its Thread had any: the
 * view as a tab, as no window opens over the Stage history.
 */
function AgentRunDetails({
  threadId,
  stages,
  taskStage,
  run,
  tab,
  personName,
  head,
  summary,
  onTab,
  onReadSummary,
}: {
  readonly threadId: string;
  readonly stages: readonly TaskStage[];
  readonly taskStage: TaskStage;
  readonly run: StageRun;
  readonly tab: RunTab;
  readonly personName: string;
  readonly head: ReactNode;
  readonly summary: ReactNode;
  readonly onTab: (tab: RunTab) => void;
  readonly onReadSummary: (run: RunPlace) => void;
}): ReactNode {
  const subAgentsAndProcesses = useSubAgentsAndProcesses(threadId) ?? [];
  const hadAny = subAgentsAndProcesses.length > 0;
  // Until the list is read, or once a fresh session took it away, its tab shows the Thread.
  const shownTab = tab === SUB_AGENTS_AND_PROCESSES && !hadAny ? "thread" : tab;
  const isLive = run.outcome === null && taskStage.state === "running";
  return (
    <section className="run-details" aria-label={`Run ${run.number}`}>
      {head}
      <div className="run-tabs">
        <Tabs
          style={{ flex: 1, borderBottom: 0 }}
          tabs={[
            { value: "summary", label: "Summary" },
            { value: "thread", label: <>Thread{isLive && <span className="live-dot" />}</> },
            ...(hadAny
              ? [
                  {
                    value: SUB_AGENTS_AND_PROCESSES,
                    label: (
                      <>
                        Sub-agents and processes{" "}
                        <Badge size="sm">{subAgentsAndProcesses.length}</Badge>
                      </>
                    ),
                  },
                ]
              : []),
          ]}
          value={shownTab}
          onChange={(value) => onTab(runTabOf(value))}
        />
        {/* Details hides tool activity, which only the Thread has. */}
        {shownTab === "thread" && <DetailsSwitch />}
        {shownTab === SUB_AGENTS_AND_PROCESSES && (
          <span className="sub-agents-and-processes-read-only">
            <Icon name="lock" size={12} />
            Read-only: only the Agent can stop them
          </span>
        )}
      </div>
      {shownTab === "summary" && <div className="run-details-body">{summary}</div>}
      {shownTab === "thread" && (
        <RunThread
          key={threadId}
          threadId={threadId}
          run={run}
          personName={personName}
          stages={stages}
          onReadSummary={onReadSummary}
          onShowSubAgentsAndProcesses={() => onTab(SUB_AGENTS_AND_PROCESSES)}
        />
      )}
      {shownTab === SUB_AGENTS_AND_PROCESSES && (
        <SubAgentsAndProcessesView threadId={threadId} personName={personName} />
      )}
    </section>
  );
}

function runTabOf(value: string): RunTab {
  if (value === "thread" || value === SUB_AGENTS_AND_PROCESSES) return value;
  return "summary";
}

function RunHead({
  taskStage,
  run,
  now,
}: {
  readonly taskStage: TaskStage;
  readonly run: StageRun;
  readonly now: Date;
}): ReactNode {
  const { session, tokens, outcome } = run;
  const badge = runBadge(run, taskStage.state);
  return (
    <div className="run-details-head">
      <strong>Run {run.number}</strong>
      <Badge tone={badge.tone} dot={taskStage.state === "running" && outcome === null}>
        {badge.words}
      </Badge>
      <span className="stage-history-facts">
        {runTimeWords(run, now)}
        {countedTokens(tokens) > 0 && (
          <>
            {" · "}
            <TokenFigure tokens={tokens} /> tokens
          </>
        )}
        {session && ` · ${SESSION_WORDS[session]}`}
      </span>
    </div>
  );
}

/** What a run came to and handed on, at reading width: a Handover note often has its own headings. */
function RunSummary({
  taskStage,
  run,
  roles,
  names,
  onClose,
}: {
  readonly taskStage: TaskStage;
  readonly run: StageRun;
  readonly roles: readonly Role[] | undefined;
  readonly names: StageNames;
  readonly onClose: () => void;
}): ReactNode {
  const { stage, state } = taskStage;
  const { carriedFailure, sentBack, gateAction, outcome } = run;
  const result = runResultText(taskStage, run);
  return (
    <div className="run-summary">
      {carriedFailure && (
        <p className="run-carried">
          <Icon name="rotate-ccw" size={12} /> {carriedFailureWords(carriedFailure, names)}
        </p>
      )}
      {sentBack && (
        <div>
          <p className="run-label">Sent back from {names(sentBack.gateKey)}</p>
          <MarkdownText text={sentBack.feedback} />
        </div>
      )}
      {result !== undefined && <MarkdownText text={result} />}
      {stage.kind === "gate" && state === "waiting-on-you" && outcome === null && (
        <div>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              onClose();
              bringIntoView(NEEDS_YOU_ELEMENT_ID);
            }}
          >
            Answer it in Needs you
          </Button>
        </div>
      )}
      {gateAction && (
        <div>
          <p className="run-label">{gateChoiceWords(gateAction, names)}</p>
          {gateAction.kind !== "drop" && gateAction.feedback !== undefined && (
            <MarkdownText text={gateAction.feedback} />
          )}
        </div>
      )}
      {outcome?.handoverNote ? (
        <section className="run-handover-note" aria-label="Handover note">
          <p className="overline">Handover note · {stageWorkerWords(taskStage, roles)}</p>
          <MarkdownText text={outcome.handoverNote} />
        </section>
      ) : (
        stage.kind === "agent" && outcome && <p className="task-quiet">No Handover note.</p>
      )}
    </div>
  );
}

/** What this run of a Gate had to show, of every kind; a run with none says nothing. */
function GateRunAttachments({
  taskId,
  stages,
  run,
}: {
  readonly taskId: string;
  readonly stages: readonly TaskStage[];
  readonly run: StageRun;
}): ReactNode {
  const attachments = useQuery(attachmentQueries.of({ kind: "task", taskId })).data ?? [];
  const ofThisRun = attachmentsOfGateRun(attachments, stages, run);
  if (ofThisRun.length === 0) return null;
  return (
    <section className="run-attachments" aria-label="Attachments">
      <p className="overline">Attachments</p>
      <AttachmentGallery rounds={oneRound(ofThisRun)} />
    </section>
  );
}

/** Each command the run started, with what it printed, which is read only for the run picked. */
function CommandLog({
  taskId,
  run,
}: {
  readonly taskId: string;
  readonly run: StageRun;
}): ReactNode {
  const hasCommands = run.commandRuns.length > 0;
  const outputs = useQuery({
    ...pipelineQueries.commandOutputs(taskId, run.id),
    enabled: hasCommands,
  });
  if (!hasCommands) {
    return (
      <p className="task-quiet">
        {run.outcome === null ? "No command has ended yet." : "No commands ran."}
      </p>
    );
  }
  return (
    <div className="command-log">
      <p className="overline">Log</p>
      {outputs.error && <RefusalAlert title="The output wasn't read" error={outputs.error} />}
      {run.commandRuns.map((commandRun, place) => {
        const output = outputs.data?.outputs[place];
        return (
          // A run's commands never change or reorder, and the same one can run twice.
          <section key={place} aria-label={commandRun.commandLine}>
            <div className="command-log-head">
              <code>{commandRun.commandLine}</code>
              <span className={`command-log-${commandRun.outcome}`}>
                {commandMarkWords(commandRun)}
              </span>
              <span className="command-log-time">{commandTimeWords(commandRun)}</span>
            </div>
            {output !== undefined && (
              <pre className="command-log-output">
                {output === "" ? "Printed nothing." : output}
              </pre>
            )}
          </section>
        );
      })}
    </div>
  );
}

/**
 * The run's Thread, following live. While its Stage runs it takes a message at the next safe point
 * (barge-in); a draft the Stage ended under stays, its composer saying why it can't go.
 */
function RunThread({
  threadId,
  run,
  personName,
  stages,
  onReadSummary,
  onShowSubAgentsAndProcesses,
}: {
  readonly threadId: string;
  readonly run: StageRun;
  readonly personName: string;
  readonly stages: readonly TaskStage[];
  readonly onReadSummary: (run: RunPlace) => void;
  /** Its line switches to the run's tab. */
  readonly onShowSubAgentsAndProcesses: () => void;
}): ReactNode {
  const thread = useQuery(threadQueries.one(threadId)).data;
  const [drafting, setDrafting] = useState(false);
  if (!thread) return null;
  const handoverNoteReader = (note: string): (() => void) | undefined => {
    const place = runOfHandoverNote(stages, threadId, note);
    return place && (() => onReadSummary(place));
  };
  return (
    <div className="run-thread">
      <ThreadLog
        thread={thread}
        personName={personName}
        leavesReaderBe
        logLines={chapterWork(stages, threadId).finishedRuns}
        handoverNoteReader={handoverNoteReader}
      />
      {takesMessages(thread) || drafting ? (
        <div className="run-thread-foot">
          <p className="run-thread-to">
            To <PersonAvatar roleKey={thread.roleKey} name={personName} size="xs" />
            <span>
              <strong>{personName}</strong>
              {thread.title !== null && `, in ${thread.title}`}: lands at the next safe point
            </span>
          </p>
          <ThreadComposer
            thread={thread}
            personName={personName}
            placeholder={`Write to ${personName} while the Stage runs…`}
            autoFocus={false}
            keepsDraft
            onDrafting={setDrafting}
            onShowSubAgentsAndProcesses={onShowSubAgentsAndProcesses}
          />
        </div>
      ) : (
        <>
          <SessionRow
            line={
              <SubAgentsAndProcessesLine
                thread={thread}
                personName={personName}
                onShow={onShowSubAgentsAndProcesses}
              />
            }
            reading={
              run.session !== null && <ContextReading look={endedRunReadingLook(run, personName)} />
            }
          />
          <div className="run-thread-closed">
            <ReadOnlyNote reason={runThreadClosedWords(run)} />
            <Link
              from="/tasks/$taskId"
              to="."
              search={(shown) => ({ ...shown, taskThread: thread.roleKey })}
              resetScroll={false}
            >
              Ask {personName} about it
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
