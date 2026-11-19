import { Link } from "@tanstack/react-router";
import type {
  FullStatsRange,
  FullStatsRead,
  Project,
  StatsCostliestInitiative,
  StatsCostliestTask,
} from "@the-office/contracts";
import { Icon } from "@the-office/ui";
import { useId, useState, type ReactNode } from "react";
import { tokensShort } from "../../shell/conversation/context-words.ts";
import { ProjectChip } from "../../shell/project-chip.tsx";
import { Picker, StatsBlock } from "./stats-parts.tsx";
import {
  COSTLIEST,
  COSTLIEST_LABELS,
  costliestEmptyWords,
  costliestWhenWords,
  costPerStageLabel,
  ESTIMATED_COST,
  INITIATIVE,
  INITIATIVE_THREADS,
  LOADING_FULL,
  OUTSIDE_A_STAGE,
  retriesCostWords,
  runsWords,
  runWords,
  SHOW,
  TASK,
  tasksWords,
  TOKENS,
  usdWords,
  type CostliestList,
} from "./stats-words.ts";

/**
 * The most expensive Tasks and Initiatives in the range (spec 2.11, Full stats 4): a Tasks or
 * Initiatives switch, each row linking to its page with its estimated cost and tokens, a bar
 * against the first row's, and opening to its cost per Stage and per try.
 */
export function CostliestWork({
  stats,
  loading,
  range,
  projects,
}: {
  readonly stats: FullStatsRead | undefined;
  readonly loading: boolean;
  readonly range: FullStatsRange;
  readonly projects: readonly Project[] | undefined;
}): ReactNode {
  const [list, setList] = useState<CostliestList>("tasks");
  const shown = loading ? undefined : stats;
  const count = shown
    ? list === "tasks"
      ? shown.costliestTasks.length
      : shown.costliestInitiatives.length
    : 0;
  return (
    <StatsBlock
      id="costliest"
      className="stats-span-12"
      title={COSTLIEST}
      when={shown && costliestWhenWords(count, shown.range)}
      tools={
        <Picker
          label={SHOW}
          options={(["tasks", "initiatives"] as const).map((value) => ({
            value,
            label: COSTLIEST_LABELS[value],
          }))}
          value={list}
          onChange={setList}
        />
      }
      loading={shown === undefined}
      loaderLabel={LOADING_FULL}
    >
      {shown &&
        (count === 0 ? (
          <p className="stats-empty">{costliestEmptyWords(list, range)}</p>
        ) : (
          <>
            <div className="stats-x-headrow" aria-hidden="true">
              <span />
              <span>{list === "tasks" ? TASK : INITIATIVE}</span>
              <span>{ESTIMATED_COST}</span>
              <span>{TOKENS}</span>
            </div>
            <ul className="stats-x-list">
              {list === "tasks"
                ? shown.costliestTasks.map((task) => (
                    <TaskRow
                      key={task.taskId}
                      task={task}
                      first={shown.costliestTasks[0]?.estimatedCostUsd ?? 0}
                      projects={projects}
                    />
                  ))
                : shown.costliestInitiatives.map((initiative) => (
                    <InitiativeRow
                      key={initiative.initiativeId}
                      initiative={initiative}
                      first={shown.costliestInitiatives[0]?.estimatedCostUsd ?? 0}
                      projects={projects}
                    />
                  ))}
            </ul>
          </>
        ))}
    </StatsBlock>
  );
}

/** A Task's Stage runs, its retries (every try after the first) and what they cost. */
function runsOf(task: StatsCostliestTask): {
  readonly runs: number;
  readonly retries: number;
  readonly retryCost: number;
} {
  const tries = task.stages.flatMap(({ tries: each }) => each);
  const retried = tries.filter(({ try: run }) => run > 1);
  return {
    runs: tries.length,
    retries: retried.length,
    retryCost: retried.reduce((sum, { estimatedCostUsd }) => sum + estimatedCostUsd, 0),
  };
}

function TaskRow({
  task,
  first,
  projects,
}: {
  readonly task: StatsCostliestTask;
  readonly first: number;
  readonly projects: readonly Project[] | undefined;
}): ReactNode {
  const { runs, retries, retryCost } = runsOf(task);
  return (
    <CostliestRow
      title={task.title}
      link={
        <Link to="/tasks/$taskId" params={{ taskId: task.taskId }} className="stats-task-link">
          {task.title}
        </Link>
      }
      chips={<ProjectChip projectId={task.projectId} projects={projects} />}
      meta={
        <>
          {runsWords(runs, retries)}
          {retries > 0 && task.estimatedCostUsd > 0 && (
            <>
              {" · "}
              <span className="stats-x-retry">
                {retriesCostWords(
                  usdWords(retryCost),
                  Math.round((retryCost / task.estimatedCostUsd) * 100),
                )}
              </span>
            </>
          )}
        </>
      }
      cost={task.estimatedCostUsd}
      tokens={task.tokens}
      first={first}
    >
      {task.stages.map((stage, index) => (
        // Two Stages of a Pipeline may share a name.
        <div key={`${index}-${stage.stageName}`} className="stats-cs-row">
          <span className="stats-cs-name">{stage.stageName}</span>
          <span className="stats-cs-runs">
            {stage.tries.map(({ try: run, estimatedCostUsd }) => (
              <span key={run} className="stats-run" data-retry={run > 1 || undefined}>
                {runWords(run, usdWords(estimatedCostUsd))}
              </span>
            ))}
          </span>
          <span className="stats-cs-cost">
            {usdWords(stage.tries.reduce((sum, each) => sum + each.estimatedCostUsd, 0))}
          </span>
        </div>
      ))}
      {(task.outsideStages.estimatedCostUsd > 0 || task.outsideStages.tokens > 0) && (
        <div className="stats-cs-row stats-cs-quiet">
          <span className="stats-cs-name">{OUTSIDE_A_STAGE}</span>
          <span className="stats-cs-runs" />
          <span className="stats-cs-cost">{usdWords(task.outsideStages.estimatedCostUsd)}</span>
        </div>
      )}
    </CostliestRow>
  );
}

function InitiativeRow({
  initiative,
  first,
  projects,
}: {
  readonly initiative: StatsCostliestInitiative;
  readonly first: number;
  readonly projects: readonly Project[] | undefined;
}): ReactNode {
  const { ownThreads } = initiative;
  return (
    <CostliestRow
      title={initiative.title}
      link={
        <Link
          to="/work/initiatives/$initiativeId"
          params={{ initiativeId: initiative.initiativeId }}
          className="stats-task-link"
        >
          {initiative.title}
        </Link>
      }
      chips={initiative.projectIds.map((projectId) => (
        <ProjectChip key={projectId} projectId={projectId} projects={projects} />
      ))}
      meta={tasksWords(initiative.tasks.length)}
      cost={initiative.estimatedCostUsd}
      tokens={initiative.tokens}
      first={first}
    >
      {(ownThreads.estimatedCostUsd > 0 || ownThreads.tokens > 0) && (
        <div className="stats-cs-row stats-cs-quiet">
          <span className="stats-cs-name">{INITIATIVE_THREADS}</span>
          <span className="stats-cs-runs" />
          <span className="stats-cs-cost">{usdWords(ownThreads.estimatedCostUsd)}</span>
        </div>
      )}
      {initiative.tasks.map((task) => (
        <div key={task.taskId} className="stats-cs-row">
          <span className="stats-cs-name">
            <Link to="/tasks/$taskId" params={{ taskId: task.taskId }} className="stats-task-link">
              {task.title}
            </Link>
          </span>
          <span className="stats-cs-runs">{tokensShort(Math.round(task.tokens))}</span>
          <span className="stats-cs-cost">{usdWords(task.estimatedCostUsd)}</span>
        </div>
      ))}
    </CostliestRow>
  );
}

function CostliestRow({
  title,
  link,
  chips,
  meta,
  cost,
  tokens,
  first,
  children,
}: {
  readonly title: string;
  readonly link: ReactNode;
  readonly chips: ReactNode;
  readonly meta: ReactNode;
  readonly cost: number;
  readonly tokens: number;
  readonly first: number;
  readonly children: ReactNode;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const foldId = useId();
  return (
    <li className="stats-x-row">
      <div className="stats-x-line">
        <button
          type="button"
          className="stats-fold"
          aria-expanded={open}
          aria-controls={open ? foldId : undefined}
          aria-label={costPerStageLabel(title)}
          onClick={() => setOpen(!open)}
        >
          <Icon name="chevron-right" size={14} />
        </button>
        <div className="stats-x-main">
          <div className="stats-x-title">
            {link}
            {chips}
          </div>
          <div className="stats-x-meta">{meta}</div>
        </div>
        <span className="stats-x-cost">{usdWords(cost)}</span>
        <span className="stats-x-tokens">{tokensShort(Math.round(tokens))}</span>
      </div>
      <div className="stats-bar-track stats-x-bar" aria-hidden="true">
        <i style={{ width: `${first > 0 ? (cost / first) * 100 : 0}%` }} />
      </div>
      {open && (
        <div id={foldId} className="stats-x-fold">
          {children}
        </div>
      )}
    </li>
  );
}
