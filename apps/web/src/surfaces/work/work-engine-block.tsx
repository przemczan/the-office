import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type {
  Engine,
  EngineId,
  Initiative,
  Project,
  Task,
  TaskSummary,
} from "@the-office/contracts";
import { Alert, GroupedSelect, Icon, Switch, type GroupedSelectGroup } from "@the-office/ui";
import type { ReactNode } from "react";
import { engineSettingsQuery } from "../../api/engine.ts";
import { roleQueries, taskEngineCascadeKey } from "../../api/people.ts";
import { projectQueries } from "../../api/projects.ts";
import { changeInitiativeEngine, changeTaskEngine, taskQueries } from "../../api/work.ts";
import {
  EFFORT_LABELS,
  ENGINE_KINDS,
  ENGINE_KIND_ICONS,
  ENGINE_KIND_LABELS,
} from "../../shell/engine-words.ts";
import { roleName } from "../../shell/person-name.ts";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import { modelAndEffortText, workSourceText } from "../../shell/role-card-words.ts";
import { useToast } from "../../shell/toasts.tsx";
import { useEngineName } from "../../shell/use-engine-name.ts";
import { TaskStateBadge } from "../../shell/work/task-state-badge.tsx";
import { useRecordChange } from "./planning-parts.tsx";
import { RecordFold } from "./record-fold.tsx";
import { useFold } from "./record-folds.ts";
import { useInitiativeChange } from "./use-initiative-change.ts";
import {
  ENGINE_REFUSED,
  INITIATIVE_ENGINE_KEPT,
  INITIATIVE_OFF_HINT,
  ITS_TASKS_NOTE,
  NO_ENGINE_LISTED,
  OVERRIDE_THE_ENGINE,
  RUNNING_STAGE_NOTE,
  RUNS_ON_NOTE,
  TASK_ENGINE_KEPT,
  TASK_FOLLOWS_INITIATIVE_HINT,
  initiativeEngineSummary,
  initiativeEngineToast,
  initiativeTaskEngine,
  isOpenTask,
  noStandInsNote,
  projectEngineOf,
  taskEngineSummary,
  taskEngineToast,
  taskFollowedEngine,
  taskFollowsLine,
  type FollowedEngine,
} from "./work-engine-words.ts";

/**
 * The Task's engine override (spec §2.1.3, "A Task's engine"): one engine, no model and no
 * Stand-in Engines, for every session about it, saved at once; read-only once Done or Dropped. Its
 * "Runs on" list says what the cascade gives each Role its Stages name. Starts folded.
 */
export function TaskEngineBlock({ task }: { readonly task: Task }): ReactNode {
  const engineName = useEngineName();
  const showToast = useToast();
  const queryClient = useQueryClient();
  const project = useQuery(projectQueries.one(task.projectId)).data;
  const engineSettings = useQuery(engineSettingsQuery()).data;
  const projectEngine = projectEngineOf(project, engineSettings);
  const followed = taskFollowedEngine(task, projectEngine);
  const fold = useFold({ kind: "task", id: task.id }, "engine", false);
  const changing = useRecordChange(task, (engineId: EngineId | null) =>
    changeTaskEngine(task.id, engineId),
  );
  const editable = task.state !== "done" && task.state !== "dropped";
  // While it saves, the fields show the choice; a refusal puts them back to what is saved.
  const shown = changing.isPending ? (changing.variables ?? null) : task.engineOverride;
  const save = (engineId: EngineId | null): void =>
    changing.mutate(engineId, {
      onSuccess: (saved) => {
        void queryClient.invalidateQueries({ queryKey: taskEngineCascadeKey(task.id) });
        showToast(taskEngineToast(saved, saved.engineOverride, engineName));
      },
    });
  return (
    <RecordFold
      fold={fold}
      icon="cpu"
      title="Engine"
      summary={taskEngineSummary(task, projectEngine, engineName)}
    >
      <div className="work-engine">
        {editable ? (
          <>
            {task.state === "in-progress" && task.pausedBy === null && (
              <Alert tone="info">{RUNNING_STAGE_NOTE}</Alert>
            )}
            <EngineOverride
              of="task"
              value={shown}
              startOn={followed?.engineId ?? null}
              hint={task.initiativeEngineOverride ? TASK_FOLLOWS_INITIATIVE_HINT : undefined}
              offLine={taskFollowsLine(
                followed,
                project?.engine.standIns.useOwnList ?? false,
                engineName,
              )}
              disabled={engineSettings === undefined || changing.isPending}
              onChange={save}
            />
            {changing.error && <RefusalAlert title={ENGINE_REFUSED} error={changing.error} />}
            <TaskRunsOn task={task} />
          </>
        ) : (
          <KeptEngine value={task.engineOverride} kept={TASK_ENGINE_KEPT} />
        )}
      </div>
    </RecordFold>
  );
}

/**
 * The switch "Override the engine", and while it is on the Engine select over the listed engines,
 * grouped by engine type, with the note that an override has no stand-ins. Turning it on saves the
 * engine the record followed; off, `offLine` names that engine.
 */
function EngineOverride({
  of,
  value,
  startOn,
  hint,
  offLine,
  disabled,
  onChange,
}: {
  readonly of: "task" | "initiative";
  readonly value: EngineId | null;
  /** The engine the record follows with the switch off, which turning it on starts on. */
  readonly startOn: EngineId | null;
  /** The switch's hint. */
  readonly hint?: string;
  /** The line under the switch while it is off. */
  readonly offLine?: string;
  readonly disabled: boolean;
  readonly onChange: (engineId: EngineId | null) => void;
}): ReactNode {
  const engineName = useEngineName();
  const engines = useQuery(engineSettingsQuery()).data?.engines;
  const noEngine = value === null && startOn === null;
  return (
    <div className="work-engine-override">
      <Switch
        checked={value !== null}
        disabled={disabled || noEngine}
        onChange={(on) => onChange(on ? startOn : null)}
        label={OVERRIDE_THE_ENGINE}
        description={noEngine ? NO_ENGINE_LISTED : hint}
      />
      {value === null ? (
        offLine !== undefined && !noEngine && <p className="task-quiet">{offLine}</p>
      ) : (
        <>
          <div className="work-engine-field">
            <GroupedSelect
              label="Engine"
              value={value}
              placeholder={engineName(value)}
              groups={engineGroups(engines ?? [])}
              disabled={disabled}
              onChange={(engineId) => {
                if (engineId !== value) onChange(engineId);
              }}
            />
          </div>
          <Alert tone="info">{noStandInsNote(value, engineName, of)}</Alert>
        </>
      )}
    </div>
  );
}

/** The listed engines, grouped by engine type in the spec's order, each with its type's icon. */
function engineGroups(engines: readonly Engine[]): GroupedSelectGroup[] {
  return ENGINE_KINDS.map((kind) => ({
    label: ENGINE_KIND_LABELS[kind],
    options: engines
      .filter((engine) => engine.kind === kind)
      .map((engine) => ({
        value: engine.id,
        label: engine.name,
        aside: <Icon name={ENGINE_KIND_ICONS[kind]} size={14} />,
      })),
  })).filter((group) => group.options.length > 0);
}

/**
 * The model and effort the Planner and each Role the Task's Stages name work with on the Task's
 * engine, where each comes from, and each Stage that sets its own effort.
 */
function TaskRunsOn({ task }: { readonly task: Task }): ReactNode {
  const cascade = useQuery(taskQueries.engineCascade(task.id)).data;
  const roles = useQuery(roleQueries.list()).data;
  if (!cascade || cascade.people.length === 0) return null;
  return (
    <div className="work-engine-list">
      <div className="work-engine-list-head">
        <h4 className="work-engine-list-title">Runs on</h4>
        <span className="task-quiet">{RUNS_ON_NOTE}</span>
      </div>
      <ul aria-label="Runs on">
        {cascade.people.map((person) => {
          const filled = roles?.find(({ key }) => key === person.roleKey);
          const name = filled ? roleName(person.roleKey, roles) : person.roleName;
          const firstName = filled?.card.name ?? person.roleName;
          return (
            <li key={person.roleKey} className="work-engine-row">
              <span className="work-engine-row-name">{name}</span>
              {cascade.engine && person.work ? (
                <span className="work-engine-row-what">
                  <span className="work-engine-row-engine">{modelAndEffortText(person.work)}</span>
                  <span className="work-engine-row-source">
                    {workSourceText(person.work, firstName)}
                  </span>
                  {person.stages.map(({ stageName, effort }) => (
                    <span key={stageName} className="work-engine-row-source here">
                      {EFFORT_LABELS[effort]} on {stageName}
                    </span>
                  ))}
                </span>
              ) : (
                <span className="work-engine-row-what task-quiet">{NO_ENGINE_LISTED}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * The Initiative's engine override (spec §2.1.4, "An Initiative's engine"): one engine, no model
 * and no Stand-in Engines, for its Threads and every Task in it with no override of its own, saved
 * at once; read-only once Done or Dropped. "Its Tasks" says which open Task follows it, from the
 * Task list the page has. Starts folded.
 */
export function InitiativeEngineBlock({
  initiative,
  tasks,
  projects,
}: {
  readonly initiative: Initiative;
  /** Its Tasks, Publishing Tasks among them. */
  readonly tasks: readonly TaskSummary[];
  readonly projects: readonly Project[] | undefined;
}): ReactNode {
  const engineName = useEngineName();
  const showToast = useToast();
  const engineSettings = useQuery(engineSettingsQuery()).data;
  const projectEngine = (projectId: string | undefined): FollowedEngine | null =>
    projectEngineOf(
      projects?.find(({ id }) => id === projectId),
      engineSettings,
    );
  const onlyProject = initiative.projectIds.length === 1 ? initiative.projectIds[0] : undefined;
  const fold = useFold({ kind: "initiative", id: initiative.id }, "engine", false);
  const changing = useInitiativeChange(initiative, (engineId: EngineId | null) =>
    changeInitiativeEngine(initiative.id, engineId),
  );
  const editable = initiative.state !== "done" && initiative.state !== "dropped";
  const openTasks = tasks.filter(isOpenTask);
  const shown = changing.isPending ? (changing.variables ?? null) : initiative.engineOverride;
  return (
    <RecordFold
      fold={fold}
      icon="cpu"
      title="Engine"
      summary={initiativeEngineSummary(
        initiative,
        onlyProject === undefined ? null : projectEngine(onlyProject),
        engineName,
      )}
    >
      <div className="work-engine">
        {editable ? (
          <>
            <EngineOverride
              of="initiative"
              value={shown}
              startOn={projectEngine(initiative.projectIds[0])?.engineId ?? null}
              hint={shown === null ? INITIATIVE_OFF_HINT : undefined}
              disabled={engineSettings === undefined || changing.isPending}
              onChange={(engineId) =>
                changing.mutate(engineId, {
                  onSuccess: (saved) =>
                    showToast(initiativeEngineToast(saved, saved.engineOverride, engineName)),
                })
              }
            />
            {changing.error && <RefusalAlert title={ENGINE_REFUSED} error={changing.error} />}
            {openTasks.length > 0 && (
              <div className="work-engine-list">
                <div className="work-engine-list-head">
                  <h4 className="work-engine-list-title">Its Tasks</h4>
                  <span className="task-quiet">{ITS_TASKS_NOTE}</span>
                </div>
                <ul aria-label="Its Tasks">
                  {openTasks.map((task) => {
                    const { engineId, source } = initiativeTaskEngine(
                      task,
                      initiative,
                      projectEngine(task.projectId),
                    );
                    return (
                      <li key={task.id} className="work-engine-row work-engine-task-row">
                        <Link
                          to="/tasks/$taskId"
                          params={{ taskId: task.id }}
                          className="work-engine-row-name"
                        >
                          {task.title}
                        </Link>
                        <TaskStateBadge
                          state={task.state}
                          pausedBy={task.pausedBy}
                          resumesAt={task.resumesAt}
                        />
                        <span className="work-engine-row-what">
                          {engineId && (
                            <span className="work-engine-row-engine">{engineName(engineId)}</span>
                          )}
                          <span
                            className={
                              source === "follows the Initiative's override"
                                ? "work-engine-row-source here"
                                : "work-engine-row-source"
                            }
                          >
                            {source}
                          </span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </>
        ) : (
          <KeptEngine value={initiative.engineOverride} kept={INITIATIVE_ENGINE_KEPT} />
        )}
      </div>
    </RecordFold>
  );
}

/** A Done or Dropped record's engine override, kept as history. */
function KeptEngine({
  value,
  kept,
}: {
  readonly value: EngineId | null;
  readonly kept: string;
}): ReactNode {
  const engineName = useEngineName();
  return (
    <>
      <dl className="work-engine-kept">
        <div className="work-engine-kept-row">
          <dt>{OVERRIDE_THE_ENGINE}</dt>
          <dd>{value ? engineName(value) : "Off"}</dd>
        </div>
      </dl>
      <p className="task-quiet work-engine-lock">
        <Icon name="lock" size={13} />
        {kept}
      </p>
    </>
  );
}
