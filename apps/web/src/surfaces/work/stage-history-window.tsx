import { countedTokens, type Role, type StageRun, type TaskStage } from "@the-office/contracts";
import { Badge, Dialog, Icon, isTopmost } from "@the-office/ui";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { TokenFigure } from "../../shell/token-count.tsx";
import { useClock } from "../../shell/use-clock.ts";
import { PipelineInSmall } from "./pipeline-in-small.tsx";
import { RunDetails } from "./run-details.tsx";
import {
  openingRunTab,
  runBadge,
  runGist,
  runTimeWords,
  stageHistoryLine,
  type RunTab,
} from "./stage-history-words.ts";
import { railStateWords } from "./stage-rail-words.ts";
import { StageWorker } from "./stage-worker.tsx";
import { waitsForRunEnvironment, type StageNames } from "./stage-words.ts";

/**
 * A Stage's history (spec 4.1): the Pipeline in small to move between Stages, the runs on the left
 * and everything about the run picked on the right, the newest at first. What was picked stays
 * while the window is open, so coming back to a Stage or a run finds it as it was left.
 */
export function StageHistoryWindow({
  taskId,
  stages,
  taskStage,
  askedRunId,
  noRunsWords,
  roles,
  names,
  onSelect,
  onClose,
}: {
  readonly taskId: string;
  readonly stages: readonly TaskStage[];
  readonly taskStage: TaskStage;
  /** The run the address named, which the window opens at. */
  readonly askedRunId: string | undefined;
  /** Why a Stage with no runs has none. */
  readonly noRunsWords: string;
  readonly roles: readonly Role[] | undefined;
  readonly names: StageNames;
  readonly onSelect: (stageKey: string) => void;
  readonly onClose: () => void;
}): ReactNode {
  const { stage, runs } = taskStage;
  const now = useClock();
  const content = useRef<HTMLDivElement>(null);
  const [pickedRuns, setPickedRuns] = useState<ReadonlyMap<string, string>>(
    () => new Map(askedRunId === undefined ? [] : [[stage.key, askedRunId]]),
  );
  const [runTabs, setRunTabs] = useState<ReadonlyMap<string, RunTab>>(new Map());
  const shownRun = runs.find(({ id }) => id === pickedRuns.get(stage.key)) ?? runs.at(-1);
  useArrowKeysStep(content, (by) => {
    const next = stages[stages.indexOf(taskStage) + by];
    if (next) onSelect(next.stage.key);
  });
  return (
    <Dialog
      size="large"
      keepsHeight
      title={
        <span className="stage-history-title">
          <span>
            <span className="visually-hidden">Stage history: </span>
            {stage.name}
          </span>
          <span className="stage-history-worker">
            <StageWorker taskStage={taskStage} roles={roles} />
          </span>
          <Badge>{railStateWords(taskStage, names)}</Badge>
          <span className="stage-history-keys" aria-hidden="true">
            <kbd>←</kbd> <kbd>→</kbd> Stages
          </span>
        </span>
      }
      onClose={onClose}
    >
      <div ref={content} className="stage-history">
        <PipelineInSmall
          stages={stages}
          selectedKey={stage.key}
          names={names}
          onSelect={onSelect}
        />
        <p className="stage-history-line">{stageHistoryLine(taskStage, roles, names)}</p>
        {shownRun ? (
          <div className="stage-history-panes">
            <ol className="stage-history-runs" aria-label="Runs">
              {runs.toReversed().map((run) => (
                <RunItem
                  key={run.id}
                  run={run}
                  taskStage={taskStage}
                  isShown={run === shownRun}
                  names={names}
                  now={now}
                  onPick={() => setPickedRuns(new Map(pickedRuns).set(stage.key, run.id))}
                />
              ))}
            </ol>
            <RunDetails
              taskId={taskId}
              stages={stages}
              taskStage={taskStage}
              run={shownRun}
              tab={runTabs.get(shownRun.id) ?? openingRunTab(shownRun)}
              roles={roles}
              names={names}
              now={now}
              onTab={(tab) => setRunTabs(new Map(runTabs).set(shownRun.id, tab))}
              onReadSummary={({ stageKey, runId }) => {
                setPickedRuns(new Map(pickedRuns).set(stageKey, runId));
                setRunTabs(new Map(runTabs).set(runId, "summary"));
                if (stageKey !== stage.key) onSelect(stageKey);
              }}
              onClose={onClose}
            />
          </div>
        ) : (
          <p className="task-quiet">{noRunsWords}</p>
        )}
      </div>
    </Dialog>
  );
}

/** A run in the list: what it is and how it ended, in a line or two. */
function RunItem({
  run,
  taskStage,
  isShown,
  names,
  now,
  onPick,
}: {
  readonly run: StageRun;
  readonly taskStage: TaskStage;
  readonly isShown: boolean;
  readonly names: StageNames;
  readonly now: Date;
  readonly onPick: () => void;
}): ReactNode {
  const badge = runBadge(run, taskStage.state);
  return (
    <li>
      <button
        type="button"
        className={`stage-history-run stage-history-run-${badge.tone}`}
        aria-pressed={isShown}
        onClick={onPick}
      >
        <span className="stage-history-run-line">
          <strong>Run {run.number}</strong>
          <Badge
            tone={badge.tone}
            dot={
              taskStage.state === "running" && run.outcome === null && !waitsForRunEnvironment(run)
            }
          >
            {badge.words}
          </Badge>
          {run.carriedFailure && (
            <span className="stage-history-run-carried" title="Briefed with what failed">
              <Icon name="rotate-ccw" size={12} />
              <span className="visually-hidden">Briefed with what failed</span>
            </span>
          )}
        </span>
        <span className="stage-history-facts">
          {runTimeWords(run, now)}
          {countedTokens(run.tokens) > 0 && (
            <>
              {" · "}
              <TokenFigure tokens={run.tokens} /> tokens
            </>
          )}
        </span>
        <span className="stage-history-gist">{runGist(taskStage, run, names)}</span>
      </button>
    </li>
  );
}

/**
 * ← and → move between Stages wherever focus is in the window, which is why they are heard on the
 * document. They stay with a field being typed in, and with an Attachment viewer opened over the window.
 */
function useArrowKeysStep(
  content: RefObject<HTMLElement | null>,
  step: (by: -1 | 1) => void,
): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      if (isTyping(event.target) || !isTopmost(content.current)) return;
      event.preventDefault();
      step(event.key === "ArrowLeft" ? -1 : 1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [content, step]);
}

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    target.closest("input, textarea, select, [contenteditable]") !== null
  );
}
