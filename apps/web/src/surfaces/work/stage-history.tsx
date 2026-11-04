import { Link } from "@tanstack/react-router";
import { countedTokens, type Role, type StageRun, type TaskStage } from "@the-office/contracts";
import { Badge, Icon, IconButton } from "@the-office/ui";
import { useEffect, useRef, type ReactNode } from "react";
import { MarkdownText } from "../../shell/markdown-text.tsx";
import { TokenFigure } from "../../shell/token-count.tsx";
import {
  carriedFailureWords,
  commandMarkWords,
  commandTimeWords,
  gateChoiceWords,
  runBadge,
  runResultText,
  runTimeWords,
  stageHistoryLine,
} from "./stage-history-words.ts";
import { useBringThreadIntoView } from "./conversation-drawer.tsx";
import { railStateWords, stageWorkerWords } from "./stage-rail-words.ts";
import { StageWorker } from "./stage-worker.tsx";
import { SESSION_WORDS, type StageNames } from "./stage-words.ts";

/**
 * The selected Stage's runs, the newest first. Clicking anywhere in it focuses it, so the rail's
 * arrow keys and Esc go on working after the reader used the mouse here.
 */
export function StageHistory({
  id,
  taskId,
  taskStage,
  noRunsWords,
  isFirst,
  isLast,
  roles,
  names,
  now,
  onStep,
  onClose,
}: {
  readonly id: string;
  readonly taskId: string;
  readonly taskStage: TaskStage;
  /** Why a Stage with no runs has none. */
  readonly noRunsWords: string;
  readonly isFirst: boolean;
  readonly isLast: boolean;
  readonly roles: readonly Role[] | undefined;
  readonly names: StageNames;
  readonly now: Date;
  readonly onStep: (step: -1 | 1) => void;
  readonly onClose: () => void;
}): ReactNode {
  const { stage, runs } = taskStage;
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    // Not returned: Chromium's scrollIntoView answers a promise, which React would take for a cleanup.
    void panel.current?.scrollIntoView({ block: "nearest" });
  }, []);
  return (
    <section
      ref={panel}
      id={id}
      className="stage-history"
      aria-label={`Stage history: ${stage.name}`}
      tabIndex={-1}
    >
      <div className="stage-history-head">
        <h3>{stage.name}</h3>
        <span className="stage-history-worker">
          <StageWorker taskStage={taskStage} roles={roles} />
        </span>
        <Badge>{railStateWords(taskStage, names)}</Badge>
        <span className="stage-history-keys">
          <kbd>←</kbd> <kbd>→</kbd> Stages · <kbd>Esc</kbd> close
        </span>
        <IconButton
          size="sm"
          label="Previous Stage"
          icon={<Icon name="chevron-left" size={14} />}
          disabled={isFirst}
          onClick={() => onStep(-1)}
        />
        <IconButton
          size="sm"
          label="Next Stage"
          icon={<Icon name="chevron-right" size={14} />}
          disabled={isLast}
          onClick={() => onStep(1)}
        />
        <IconButton
          size="sm"
          label="Close the Stage history"
          icon={<Icon name="x" size={14} />}
          onClick={onClose}
        />
      </div>
      <p className="stage-history-line">{stageHistoryLine(taskStage, roles, names)}</p>
      {runs.length > 0 ? (
        <ol className="stage-history-runs">
          {runs.toReversed().map((run) => (
            <RunEntry
              key={run.id}
              run={run}
              taskId={taskId}
              taskStage={taskStage}
              roles={roles}
              names={names}
              now={now}
            />
          ))}
        </ol>
      ) : (
        <p className="task-quiet">{noRunsWords}</p>
      )}
    </section>
  );
}

function RunEntry({
  run,
  taskId,
  taskStage,
  roles,
  names,
  now,
}: {
  readonly run: StageRun;
  readonly taskId: string;
  readonly taskStage: TaskStage;
  readonly roles: readonly Role[] | undefined;
  readonly names: StageNames;
  readonly now: Date;
}): ReactNode {
  const { carriedFailure, sentBack, commandRuns, gateAction, outcome, session, threadId } = run;
  const bringThreadIntoView = useBringThreadIntoView();
  const badge = runBadge(run, taskStage.state);
  const result = runResultText(taskStage, run);
  return (
    <li className={`stage-history-run stage-history-run-${badge.tone}`}>
      <div className="stage-history-run-head">
        <strong>Run {run.number}</strong>
        <Badge tone={badge.tone} dot={taskStage.state === "running" && outcome === null}>
          {badge.words}
        </Badge>
        <span className="stage-history-facts">
          {runTimeWords(run, now)}
          {countedTokens(run.tokens) > 0 && (
            <>
              {" · "}
              <TokenFigure tokens={run.tokens} /> tokens
            </>
          )}
          {session && ` · ${SESSION_WORDS[session]}`}
        </span>
        {/* One Thread can hold several runs, so each run has its own way there. */}
        {threadId && (
          <Link
            className="stage-history-thread"
            to="/tasks/$taskId"
            params={{ taskId }}
            search={(search) => ({ ...search, taskThread: threadId })}
            resetScroll={false}
            onClick={() => bringThreadIntoView(threadId)}
          >
            {outcome === null ? "Open its Thread · live" : "Open its Thread"}
          </Link>
        )}
      </div>
      {carriedFailure && (
        <p className="stage-history-carried">
          <Icon name="rotate-ccw" size={12} /> {carriedFailureWords(carriedFailure, names)}
        </p>
      )}
      {sentBack && (
        <div className="stage-history-text">
          <p className="stage-history-label">Sent back from {names(sentBack.gateKey)}</p>
          <MarkdownText text={sentBack.feedback} />
        </div>
      )}
      {result !== undefined && (
        <div className="stage-history-text">
          <MarkdownText text={result} />
        </div>
      )}
      {commandRuns.length > 0 && (
        <ul className="stage-history-commands" aria-label="Commands">
          {commandRuns.map((commandRun, place) => (
            // A run's commands never change or reorder, and the same one can run twice.
            <li key={place}>
              <code>{commandRun.commandLine}</code>{" "}
              <span className={`stage-history-command-${commandRun.outcome}`}>
                {commandMarkWords(commandRun)}
              </span>{" "}
              <span className="stage-history-command-time">{commandTimeWords(commandRun)}</span>
            </li>
          ))}
        </ul>
      )}
      {gateAction && (
        <div className="stage-history-text">
          <p className="stage-history-label">{gateChoiceWords(gateAction, names)}</p>
          {gateAction.kind === "send-back" && <MarkdownText text={gateAction.feedback} />}
        </div>
      )}
      {outcome?.handoverNote && (
        <div className="stage-history-note">
          <p className="overline">Handover note · {stageWorkerWords(taskStage, roles)}</p>
          <MarkdownText text={outcome.handoverNote} />
        </div>
      )}
    </li>
  );
}
