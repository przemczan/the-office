import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  effortSchema,
  type Engine,
  type EngineId,
  type EngineKind,
  type EngineTypeSetting,
  type Initiative,
  type Project,
  type Task,
  type TaskEngineCascade,
  type TaskPersonEngineSettings,
  type TaskSummary,
} from "@the-office/contracts";
import {
  Alert,
  GroupedSelect,
  Icon,
  Select,
  Switch,
  type GroupedSelectGroup,
} from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { engineSettingsQuery } from "../../api/engine.ts";
import { roleCardQueries, roleQueries, taskEngineCascadeKey } from "../../api/people.ts";
import { projectQueries } from "../../api/projects.ts";
import { changeInitiativeEngine, changeTaskEngine, taskQueries } from "../../api/work.ts";
import {
  EFFORT_LABELS,
  ENGINE_KINDS,
  modelLabel,
  ENGINE_KIND_ICONS,
  ENGINE_KIND_LABELS,
} from "../../shell/engine-words.ts";
import { PersonAvatar } from "../../shell/person-avatar.tsx";
import { roleName } from "../../shell/person-name.ts";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import { modelAndEffortText, workSourceText } from "../../shell/role-card-words.ts";
import { useToast } from "../../shell/toasts.tsx";
import { useEngineName } from "../../shell/use-engine-name.ts";
import { ENGINES_DEFAULT_CHOICE, modelChoices, typeOfferOf } from "../../shell/engine-offers.ts";
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
  MODELS_REFUSED,
  NO_ENGINE_LISTED,
  OVERRIDE_MODELS_AND_EFFORTS,
  OVERRIDE_MODELS_HINT,
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
  taskPeopleClearedToast,
  taskPersonToast,
  type FollowedEngine,
} from "./work-engine-words.ts";

/**
 * The Task's engine override (spec §2.1.3, "A Task's engine"): one engine, no model and no
 * Stand-in Engines, for every session about it, saved at once; read-only once Done or Dropped. Its
 * "Runs on" list says what the cascade gives each Role its Stages name. Starts open, on the Engine tab.
 */
export function TaskEngineBlock({ task }: { readonly task: Task }): ReactNode {
  const engineName = useEngineName();
  const showToast = useToast();
  const queryClient = useQueryClient();
  const project = useQuery(projectQueries.one(task.projectId)).data;
  const engineSettings = useQuery(engineSettingsQuery()).data;
  const projectEngine = projectEngineOf(project, engineSettings);
  const followed = taskFollowedEngine(task, projectEngine);
  const fold = useFold({ kind: "task", id: task.id }, "engine", true);
  const changing = useRecordChange(task, (engineId: EngineId | null) =>
    changeTaskEngine(task.id, engineId),
  );
  const changingPeople = useRecordChange(task, (people: readonly TaskPersonEngineSettings[]) =>
    changeTaskEngine(task.id, task.engineOverride, people),
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
              // A models save sends the engine as saved, so neither part changes while the other saves.
              disabled={
                engineSettings === undefined || changing.isPending || changingPeople.isPending
              }
              onChange={save}
            />
            {changing.error && <RefusalAlert title={ENGINE_REFUSED} error={changing.error} />}
            <ModelsOverride
              task={task}
              pending={changing.isPending || changingPeople.isPending}
              refusal={changingPeople.error}
              onSave={(people, toast) =>
                changingPeople.mutate(people, {
                  onSuccess: () => {
                    void queryClient.invalidateQueries({ queryKey: taskEngineCascadeKey(task.id) });
                    showToast(toast);
                  },
                })
              }
            />
          </>
        ) : (
          <KeptEngine
            value={task.engineOverride}
            kept={TASK_ENGINE_KEPT}
            modelsSet={task.peopleEngineSettings.length > 0}
          />
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
function TaskRunsOn({
  cascade,
  models,
}: {
  readonly cascade: TaskEngineCascade | undefined;
  /** While models and efforts are overridden: each person's selects. */
  readonly models?: PersonSettingsEditor;
}): ReactNode {
  const roles = useQuery(roleQueries.list()).data;
  if (!cascade || cascade.people.length === 0) return null;
  return (
    <div className="work-engine-list">
      <div className="work-engine-list-head">
        <h4 className="work-engine-list-title">Runs on</h4>
        <span className="task-quiet">{RUNS_ON_NOTE}</span>
      </div>
      <ul aria-label="Runs on" className="work-engine-people">
        {cascade.people.map((person) => {
          const filled = roles?.find(({ key }) => key === person.roleKey);
          const name = filled ? roleName(person.roleKey, roles) : person.roleName;
          const firstName = filled?.card.name ?? person.roleName;
          const work = cascade.engine ? person.work : null;
          return (
            <li key={person.roleKey}>
              <div className="work-engine-person" role="group" aria-label={name}>
                <PersonAvatar roleKey={person.roleKey} name={firstName} size="sm" />
                <div className="work-engine-person-top">
                  <span className="work-engine-person-name">{name}</span>
                  {work ? (
                    <span className="work-engine-person-works">{modelAndEffortText(work)}</span>
                  ) : (
                    <span className="work-engine-person-works task-quiet">{NO_ENGINE_LISTED}</span>
                  )}
                </div>
                {work && (
                  <div className="work-engine-person-rest">
                    <div className="work-engine-person-sources">
                      <span className="work-engine-row-source">
                        {workSourceText(work, firstName)}
                      </span>
                      {person.stages.map(({ stageName, effort }) => (
                        <span key={stageName} className="work-engine-row-source here">
                          {EFFORT_LABELS[effort]} on {stageName}
                        </span>
                      ))}
                    </div>
                    {models && cascade.engine && (
                      <PersonSelects
                        person={person}
                        type={cascade.engine.engineType}
                        editor={models}
                      />
                    )}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** What `TaskRunsOn`'s selects read and change: the Task's setting for each person. */
interface PersonSettingsEditor {
  readonly settings: readonly TaskPersonEngineSettings[];
  readonly disabled: boolean;
  readonly onChange: (roleKey: string, type: EngineKind, setting: EngineTypeSetting) => void;
}

/**
 * The switch "Override models and efforts" (spec §2.1.3, "A Task's engine"), independent of the
 * engine override: while it is on each person in "Runs on" gets a Model and an Effort select over what
 * the Task's engine type offers, each saved at once; off clears every setting.
 */
function ModelsOverride({
  task,
  pending,
  refusal,
  onSave,
}: {
  readonly task: Task;
  readonly pending: boolean;
  readonly refusal: Error | null;
  readonly onSave: (people: readonly TaskPersonEngineSettings[], toast: string) => void;
}): ReactNode {
  const cascade = useQuery(taskQueries.engineCascade(task.id)).data;
  const roles = useQuery(roleQueries.list()).data;
  const [turnedOn, setTurnedOn] = useState(false);
  const on = turnedOn || task.peopleEngineSettings.length > 0;
  const change = (roleKey: string, type: EngineKind, setting: EngineTypeSetting): void => {
    const others = task.peopleEngineSettings.filter((person) => person.roleKey !== roleKey);
    const own = task.peopleEngineSettings.find((person) => person.roleKey === roleKey);
    const person = cascade?.people.find((each) => each.roleKey === roleKey);
    const filled = roles?.find(({ key }) => key === roleKey);
    onSave(
      [...others, { roleKey, engineSettings: { ...own?.engineSettings, [type]: setting } }],
      taskPersonToast(task, filled?.card.name ?? person?.roleName ?? roleKey, setting),
    );
  };
  return (
    <>
      <div className="work-engine-override">
        <Switch
          checked={on}
          disabled={pending}
          onChange={(next) => {
            setTurnedOn(next);
            if (!next && task.peopleEngineSettings.length > 0) {
              onSave([], taskPeopleClearedToast(task));
            }
          }}
          label={OVERRIDE_MODELS_AND_EFFORTS}
          description={OVERRIDE_MODELS_HINT}
        />
      </div>
      {refusal && <RefusalAlert title={MODELS_REFUSED} error={refusal} />}
      <TaskRunsOn
        cascade={cascade}
        models={
          on
            ? { settings: task.peopleEngineSettings, disabled: pending, onChange: change }
            : undefined
        }
      />
    </>
  );
}

/** Unchanged names what the levels below give, unless this Task's own setting is what shows. */
function unchangedChoice(level: string | undefined, text: string | undefined): string {
  return level === undefined || level === "taskPerson" || text === undefined
    ? "Unchanged"
    : `Unchanged · ${text}`;
}

/**
 * One person's Model and Effort selects on the Task's engine type, each starting on Unchanged; the
 * person's group names whose they are.
 */
function PersonSelects({
  person,
  type,
  editor,
}: {
  readonly person: TaskEngineCascade["people"][number];
  readonly type: EngineKind;
  readonly editor: PersonSettingsEditor;
}): ReactNode {
  const options = useQuery(roleCardQueries.options()).data;
  const offer = typeOfferOf(options, type);
  const setting = editor.settings.find(({ roleKey }) => roleKey === person.roleKey)?.engineSettings[
    type
  ] ?? { model: null, effort: null };
  const work = person.work;
  const change = (next: Partial<EngineTypeSetting>): void =>
    editor.onChange(person.roleKey, type, { ...setting, ...next });
  return (
    <div className="work-engine-person-selects">
      <Select
        label="Model"
        size="sm"
        value={setting.model ?? ENGINES_DEFAULT_CHOICE}
        options={modelChoices(
          offer.models,
          setting.model,
          unchangedChoice(work?.modelLevel, work ? modelLabel(work.model) : undefined),
        )}
        disabled={editor.disabled}
        onChange={(model) => change({ model: model === ENGINES_DEFAULT_CHOICE ? null : model })}
      />
      {offer.efforts.length > 0 && (
        <Select
          label="Effort"
          size="sm"
          value={setting.effort ?? ENGINES_DEFAULT_CHOICE}
          options={[
            {
              value: ENGINES_DEFAULT_CHOICE,
              label: unchangedChoice(
                work?.effortLevel,
                work?.effort ? EFFORT_LABELS[work.effort] : undefined,
              ),
            },
            ...offer.efforts.map((effort) => ({ value: effort, label: EFFORT_LABELS[effort] })),
          ]}
          disabled={editor.disabled}
          onChange={(effort) => change({ effort: effortSchema.safeParse(effort).data ?? null })}
        />
      )}
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
  modelsSet,
}: {
  readonly value: EngineId | null;
  readonly kept: string;
  /** A Task's: whether it set models and efforts for people; left out for an Initiative's. */
  readonly modelsSet?: boolean;
}): ReactNode {
  const engineName = useEngineName();
  return (
    <>
      <dl className="work-engine-kept">
        <div className="work-engine-kept-row">
          <dt>{OVERRIDE_THE_ENGINE}</dt>
          <dd>{value ? engineName(value) : "Off"}</dd>
        </div>
        {modelsSet !== undefined && (
          <div className="work-engine-kept-row">
            <dt>{OVERRIDE_MODELS_AND_EFFORTS}</dt>
            <dd>{modelsSet ? "On" : "Off"}</dd>
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
