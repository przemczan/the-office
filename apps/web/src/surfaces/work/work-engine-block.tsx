import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { EngineModel, Initiative, Project, Task, TaskSummary } from "@the-office/contracts";
import { Alert, Icon } from "@the-office/ui";
import type { ReactNode } from "react";
import { engineSettingsQuery } from "../../api/engine.ts";
import { roleCardQueries, roleQueries, taskEngineCascadeKey } from "../../api/people.ts";
import { projectQueries } from "../../api/projects.ts";
import { changeInitiativeEngine, changeTaskEngine, taskQueries } from "../../api/work.ts";
import { EngineModelFields, type OfferedEngine } from "../../shell/engine-model-fields.tsx";
import { modelLabel } from "../../shell/engine-words.ts";
import { roleName } from "../../shell/person-name.ts";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import { ENGINE_CASCADE_LEVEL_WORDS } from "../../shell/role-card-words.ts";
import { useToast } from "../../shell/toasts.tsx";
import { useEngineName } from "../../shell/use-engine-name.ts";
import { TaskStateBadge } from "../../shell/work/task-state-badge.tsx";
import { useRecordChange } from "./planning-parts.tsx";
import { RecordFold } from "./record-fold.tsx";
import { useFold } from "./record-folds.ts";
import { useInitiativeChange } from "./use-initiative-change.ts";
import {
  ENGINE_CHANGE_NOTE,
  ENGINE_REFUSED,
  INITIATIVE_ENGINE_INTRO,
  INITIATIVE_ENGINE_KEPT,
  INITIATIVE_NONE_HINT,
  ITS_TASKS_NOTE,
  RUNNING_STAGE_NOTE,
  RUNS_ON_NOTE,
  TASK_ENGINE_INTRO,
  TASK_ENGINE_KEPT,
  initiativeEngineSummary,
  initiativeEngineToast,
  initiativeNoneLabel,
  initiativeTaskEngine,
  isOpenTask,
  onEngine,
  projectEngineOf,
  taskEngineSummary,
  taskEngineToast,
  taskNoneHint,
  taskNoneLabel,
} from "./work-engine-words.ts";

const NO_ENGINES: readonly OfferedEngine[] = [];

/**
 * The Task's engine (spec §2.1.3, "A Task's engine"): an engine and model taking the Project
 * default's place for every session about it, saved at once; read-only once Done or Dropped. Its
 * "Runs on" list says what the cascade gives each Role its Stages name. Starts folded.
 */
export function TaskEngineBlock({ task }: { readonly task: Task }): ReactNode {
  const engineName = useEngineName();
  const showToast = useToast();
  const queryClient = useQueryClient();
  const engines = useQuery(roleCardQueries.options()).data?.engines;
  const project = useQuery(projectQueries.one(task.projectId)).data;
  const engineSettings = useQuery(engineSettingsQuery()).data;
  const projectEngine = projectEngineOf(project, engineSettings);
  const fold = useFold({ kind: "task", id: task.id }, "engine", false);
  const changing = useRecordChange(task, (engine: EngineModel | null) =>
    changeTaskEngine(task.id, engine),
  );
  const editable = task.state !== "done" && task.state !== "dropped";
  const noneLabel = taskNoneLabel(task, engineName);
  // While it saves, the fields show the choice; a refusal puts them back to what is saved.
  const shown = changing.isPending ? (changing.variables ?? null) : task.engine;
  return (
    <RecordFold
      fold={fold}
      icon="cpu"
      title="Engine"
      summary={taskEngineSummary(task, projectEngine, engineName)}
    >
      <div className="work-engine">
        <p className="task-quiet">{TASK_ENGINE_INTRO}</p>
        {editable ? (
          <>
            {task.state === "in-progress" && task.pausedBy === null && (
              <Alert tone="info">{RUNNING_STAGE_NOTE}</Alert>
            )}
            <div className="work-engine-pair" role="group" aria-label="Task's engine">
              <EngineModelFields
                value={shown}
                engines={engines ?? NO_ENGINES}
                noneLabel={noneLabel}
                noneHint={taskNoneHint(task, project)}
                disabled={engines === undefined || changing.isPending}
                onChange={(engine) => {
                  const before = task.engine;
                  changing.mutate(engine, {
                    onSuccess: (saved) => {
                      void queryClient.invalidateQueries({
                        queryKey: taskEngineCascadeKey(task.id),
                      });
                      showToast(
                        taskEngineToast(
                          saved,
                          before,
                          saved.engine,
                          task.initiativeEngine ?? projectEngine,
                          engineName,
                        ),
                      );
                    },
                  });
                }}
              />
            </div>
            {changing.error && <RefusalAlert title={ENGINE_REFUSED} error={changing.error} />}
            <p className="task-quiet">{ENGINE_CHANGE_NOTE}</p>
            <TaskRunsOn task={task} />
          </>
        ) : (
          <KeptEngine value={task.engine} noneLabel={noneLabel} kept={TASK_ENGINE_KEPT} />
        )}
      </div>
    </RecordFold>
  );
}

/** What the Planner and each Role the Task's Stages name run on for it, and where it comes from. */
function TaskRunsOn({ task }: { readonly task: Task }): ReactNode {
  const cascade = useQuery(taskQueries.engineCascade(task.id)).data;
  const roles = useQuery(roleQueries.list()).data;
  const engineName = useEngineName();
  if (!cascade || cascade.roles.length === 0) return null;
  return (
    <div className="work-engine-list">
      <div className="work-engine-list-head">
        <h4 className="work-engine-list-title">Runs on</h4>
        <span className="task-quiet">{RUNS_ON_NOTE}</span>
      </div>
      <ul aria-label="Runs on">
        {cascade.roles.map((role) => {
          const name = roles?.some(({ key }) => key === role.roleKey)
            ? roleName(role.roleKey, roles)
            : role.roleName;
          return (
            <li key={role.roleKey} className="work-engine-row">
              <span className="work-engine-row-name">{name}</span>
              {role.engine ? (
                <span className="work-engine-row-what">
                  <span className="work-engine-row-engine">
                    {onEngine(role.engine, engineName)}
                  </span>
                  <span
                    className={
                      role.engine.level === "task-engine" ||
                      role.engine.level === "initiative-engine"
                        ? "work-engine-row-source here"
                        : "work-engine-row-source"
                    }
                  >
                    from {ENGINE_CASCADE_LEVEL_WORDS[role.engine.level]}
                  </span>
                </span>
              ) : (
                <span className="work-engine-row-what task-quiet">
                  No engine: add one in Settings › Engines
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * The Initiative's engine (spec §2.1.4, "An Initiative's engine"): what its Threads run on and
 * every Task in it that sets none, saved at once; read-only once Done or Dropped. "Its Tasks" says
 * the level each open Task takes, from the Task list the page has. Starts folded.
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
  const engines = useQuery(roleCardQueries.options()).data?.engines;
  const engineSettings = useQuery(engineSettingsQuery()).data;
  const projectEngine = (projectId: string): EngineModel | null =>
    projectEngineOf(
      projects?.find(({ id }) => id === projectId),
      engineSettings,
    );
  const onlyProject = initiative.projectIds.length === 1 ? initiative.projectIds[0] : undefined;
  const fold = useFold({ kind: "initiative", id: initiative.id }, "engine", false);
  const changing = useInitiativeChange(initiative, (engine: EngineModel | null) =>
    changeInitiativeEngine(initiative.id, engine),
  );
  const editable = initiative.state !== "done" && initiative.state !== "dropped";
  const openTasks = tasks.filter(isOpenTask);
  const noneLabel = initiativeNoneLabel(initiative);
  const shown = changing.isPending ? (changing.variables ?? null) : initiative.engine;
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
        <p className="task-quiet">{INITIATIVE_ENGINE_INTRO}</p>
        {editable ? (
          <>
            <div className="work-engine-pair" role="group" aria-label="Initiative's engine">
              <EngineModelFields
                value={shown}
                engines={engines ?? NO_ENGINES}
                noneLabel={noneLabel}
                noneHint={INITIATIVE_NONE_HINT}
                disabled={engines === undefined || changing.isPending}
                onChange={(engine) => {
                  const before = initiative.engine;
                  const taking = openTasks.filter((task) => task.engine === null).length;
                  changing.mutate(engine, {
                    onSuccess: (saved) =>
                      showToast(
                        initiativeEngineToast(saved, before, saved.engine, taking, engineName),
                      ),
                  });
                }}
              />
            </div>
            {changing.error && <RefusalAlert title={ENGINE_REFUSED} error={changing.error} />}
            <p className="task-quiet">
              {ENGINE_CHANGE_NOTE} Its Tasks' pages show the change at once.
            </p>
            {openTasks.length > 0 && (
              <div className="work-engine-list">
                <div className="work-engine-list-head">
                  <h4 className="work-engine-list-title">Its Tasks</h4>
                  <span className="task-quiet">{ITS_TASKS_NOTE}</span>
                </div>
                <ul aria-label="Its Tasks">
                  {openTasks.map((task) => {
                    const { engine, source } = initiativeTaskEngine(
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
                          {engine && (
                            <span className="work-engine-row-engine">
                              {onEngine(engine, engineName)}
                            </span>
                          )}
                          <span
                            className={
                              source === "the Initiative's engine"
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
          <KeptEngine
            value={initiative.engine}
            noneLabel={noneLabel}
            kept={INITIATIVE_ENGINE_KEPT}
          />
        )}
      </div>
    </RecordFold>
  );
}

/** A Done or Dropped record's engine, kept as history. */
function KeptEngine({
  value,
  noneLabel,
  kept,
}: {
  readonly value: EngineModel | null;
  readonly noneLabel: string;
  readonly kept: string;
}): ReactNode {
  const engineName = useEngineName();
  return (
    <>
      <dl className="work-engine-kept">
        <div className="work-engine-kept-row">
          <dt>Engine</dt>
          <dd>{value ? engineName(value.engineId) : noneLabel}</dd>
        </div>
        {value && (
          <div className="work-engine-kept-row">
            <dt>Model</dt>
            <dd>{modelLabel(value.model)}</dd>
          </div>
        )}
      </dl>
      <p className="task-quiet work-engine-lock">
        <Icon name="lock" size={13} />
        {kept}
      </p>
    </>
  );
}
