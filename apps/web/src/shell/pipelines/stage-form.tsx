import {
  afterConflictSchema,
  dutyKeySchema,
  effortSchema,
  publishTargetSchema,
  scriptStageCommandSchema,
  type Duty,
  type DutyKey,
  type Role,
  type RoleCardOptions,
  type Stage,
} from "@the-office/contracts";
import { GroupedSelect, Input, Select, Textarea, type GroupedSelectOption } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { DUTY_LABELS, dutyHolder, STAGE_DUTIES } from "../duty-words.ts";
import { EFFORT_LABELS } from "../engine-words.ts";
import { AFTER_CONFLICT_NAMES, PUBLISH_TARGET_NAMES, thousands } from "./pipeline-words.ts";
import {
  ANOTHER_KEY,
  commandChoices,
  commandKeysOf,
  PUBLISH_COMMAND,
  type StageCommandSource,
} from "./stage-commands.ts";
import {
  canContinue,
  replaceStage,
  stageWorker,
  withCommand,
  withDuty,
  withRole,
  type AgentStage,
  type ScriptStage,
} from "./stage-edits.ts";
import { StageContextLimitFields } from "./stage-context-limit-fields.tsx";
import { StagePermissionFields } from "./stage-permission-fields.tsx";
import "./stage-form.css";

/** A Select's value for "keep the person's effort": the Stage leaves it out. */
const PERSONS_EFFORT = "";

/**
 * What "Who works it" holds for a duty, apart from a Role's key by its prefix; only the form reads
 * it, the Stage naming the duty by its key alone.
 */
const DUTY_CHOICE = "duty:";

/** The library's choices while the Projects load: Publish, and another key. */
const NO_PROJECTS: StageCommandSource = { kind: "library", projects: [] };

export interface StageFormProps {
  /** The list the Stage is in; a Stage template is a list of its one Stage. */
  readonly stages: readonly Stage[];
  readonly index: number;
  readonly onChange: (stages: readonly Stage[]) => void;
  /** Everyone hired, who may work an Agent Stage when their Task limit isn't none. */
  readonly roles: readonly Role[];
  /** Every duty with its holder, as an Agent Stage naming one is worked. */
  readonly duties: readonly Duty[];
  readonly options: RoleCardOptions;
  /** What a Script Stage may run: the Task's Project's commands, or every Project's; none while loading. */
  readonly commands?: StageCommandSource;
}

/**
 * One Stage's fields (spec §2.3), the same in the flow editor's panel and for a Stage template, each
 * change answering the list with the Stage replaced. On failure isn't among them: the flow editor
 * sets it in a section of its own (`flow-on-failure.tsx`), and a Stage template has none, as going
 * back names an earlier Stage of a Pipeline.
 */
export function StageForm(props: StageFormProps): ReactNode {
  const { stages, index } = props;
  const stage = stages[index];
  if (!stage) return null;
  return <StageFields {...props} stage={stage} />;
}

function StageFields(props: StageFormProps & { readonly stage: Stage }): ReactNode {
  const { stage, stages, index, onChange } = props;
  const change = (changed: Stage): void => onChange(replaceStage(stages, index, changed));
  return (
    <div className="stage-form">
      <Input
        label="Name"
        hint={
          stage.kind === "gate"
            ? "A label for you; the Agents don't read it or act on it"
            : undefined
        }
        value={stage.name}
        onChange={(event) => change({ ...stage, name: event.target.value })}
      />
      {stage.kind === "agent" && <RoleSelect {...props} stage={stage} />}
      {stage.kind === "script" && (
        <CommandFields stage={stage} change={change} source={props.commands ?? NO_PROJECTS} />
      )}
      {stage.kind === "script" && stage.command === PUBLISH_COMMAND && (
        <PublishFields stage={stage} change={change} />
      )}
      {stage.kind === "gate" && (
        <Input
          label="What you see"
          disabled
          value="The diff, results, Attachments and screenshots so far"
        />
      )}
      {stage.kind === "agent" && <AgentFields {...props} stage={stage} change={change} />}
    </div>
  );
}

/**
 * Who may work an Agent Stage: a duty, worked by whoever holds it when the Stage starts, or anyone
 * hired with a Task limit. The current choice stays listed when it no longer qualifies, so the
 * problem shows instead of the Stage silently changing.
 */
function RoleSelect({
  stage,
  stages,
  index,
  roles,
  duties,
  options,
  onChange,
}: StageFormProps & { readonly stage: AgentStage }): ReactNode {
  const worker = stageWorker(stage);
  const choose = (value: string): void => {
    const duty = value.startsWith(DUTY_CHOICE)
      ? dutyKeySchema.safeParse(value.slice(DUTY_CHOICE.length)).data
      : undefined;
    const changed = duty ? withDuty(stages, index, duty) : withRole(stages, index, value);
    onChange(replaceStage(stages, index, changed));
  };
  return (
    <GroupedSelect
      label="Who works it"
      hint="A duty's holder when the Stage starts, as Settings › Duties sets, or a person with a Task limit"
      placeholder="Choose…"
      value={worker === undefined ? "" : "duty" in worker ? dutyChoice(worker.duty) : worker.role}
      groups={[
        { label: "Duties", options: dutyChoices(stage, duties) },
        { label: "People", options: peopleChoices(stage, roles, options) },
      ]}
      onChange={choose}
    />
  );
}

function dutyChoice(duty: DutyKey): string {
  return `${DUTY_CHOICE}${duty}`;
}

/** The duties a Stage may name, and the one it names when that is another, kept listed. */
function dutyChoices(stage: AgentStage, duties: readonly Duty[]): GroupedSelectOption[] {
  const worker = stageWorker(stage);
  const named = worker && "duty" in worker ? worker.duty : undefined;
  const offered =
    named === undefined || STAGE_DUTIES.includes(named) ? STAGE_DUTIES : [...STAGE_DUTIES, named];
  return offered.map((duty) => ({ value: dutyChoice(duty), label: dutyLabel(duty, duties) }));
}

/** "Implements · Ada · Developer", or "Implements · nobody holds it". */
function dutyLabel(duty: DutyKey, duties: readonly Duty[]): string {
  const holder = dutyHolder(duty, duties);
  const holding = holder ? `${holder.name} · ${holder.title}` : "nobody holds it";
  return `${DUTY_LABELS[duty]} · ${holding}`;
}

/** Anyone hired with a Task limit, and the Role the Stage names when nobody can work it. */
function peopleChoices(
  stage: AgentStage,
  roles: readonly Role[],
  options: RoleCardOptions,
): GroupedSelectOption[] {
  const working = roles.filter(({ card, letGoAt }) => card.taskLimit !== "none" && !letGoAt);
  const choices = working.map(({ key, card }) => ({
    value: key,
    label: `${card.name} · ${card.title}`,
  }));
  const worker = stageWorker(stage);
  if (worker && "role" in worker && !working.some(({ key }) => key === worker.role)) {
    const current = roles.find(({ key }) => key === worker.role);
    choices.push({ value: worker.role, label: unavailableLabel(worker.role, current, options) });
  }
  return choices;
}

function AgentFields({
  stage,
  stages,
  index,
  roles,
  duties,
  options,
  commands = NO_PROJECTS,
  change,
}: StageFormProps & {
  readonly stage: AgentStage;
  readonly change: (stage: Stage) => void;
}): ReactNode {
  const continuing = canContinue(stages, index);
  const role = roles.find(({ key }) => key === workingRoleKey(stage, duties));
  return (
    <>
      <Select
        label="Session"
        hint={
          continuing
            ? undefined
            : "Continuing needs the same Role or the same duty in the Stage before"
        }
        value={stage.session}
        options={[
          { value: "fresh", label: "Fresh, with a brief" },
          ...(continuing || stage.session === "continue"
            ? [{ value: "continue", label: "Continue the previous Stage's session" }]
            : []),
        ]}
        onChange={(session) =>
          change({ ...stage, session: session === "continue" ? "continue" : "fresh" })
        }
      />
      <BudgetInput stage={stage} change={change} />
      <Select
        label="Effort"
        hint="Wins over the person's and the Project's; one the engine type doesn't take gives way to the person's"
        value={stage.effort ?? PERSONS_EFFORT}
        options={[
          { value: PERSONS_EFFORT, label: "Person's effort" },
          ...effortSchema.options.map((effort) => ({
            value: effort,
            label: EFFORT_LABELS[effort],
          })),
        ]}
        onChange={(effort) => change({ ...stage, effort: effortSchema.safeParse(effort).data })}
      />
      <StageContextLimitFields stage={stage} change={change} />
      <div className="stage-form-wide">
        <Textarea
          label="Brief"
          hint="Filled with the Task's Plan, Definition of Done and earlier results"
          rows={2}
          value={stage.brief}
          onChange={(event) => change({ ...stage, brief: event.target.value })}
        />
      </div>
      <StagePermissionFields
        stage={stage}
        role={role}
        options={options}
        commandKeys={commandKeysOf(commands)}
        change={change}
      />
    </>
  );
}

/** The budget in thousands of tokens, kept as typed until it is a number above 0. */
function BudgetInput({
  stage,
  change,
}: {
  readonly stage: AgentStage;
  readonly change: (stage: Stage) => void;
}): ReactNode {
  const [typed, setTyped] = useState(String(thousands(stage.budget)));
  const [shownBudget, setShownBudget] = useState(stage.budget);
  // A budget set from outside, such as Set back, shows; one typed here stays as typed.
  if (stage.budget !== shownBudget) {
    setShownBudget(stage.budget);
    setTyped(String(thousands(stage.budget)));
  }
  return (
    <Input
      label="Budget"
      hint="Reaching it asks you"
      type="number"
      min={1}
      suffix="k tokens"
      value={typed}
      onChange={(event) => {
        setTyped(event.target.value);
        const budget = Math.round(Number(event.target.value) * 1000);
        if (event.target.value !== "" && budget > 0) {
          setShownBudget(budget);
          change({ ...stage, budget });
        }
      }}
    />
  );
}

function PublishFields({
  stage,
  change,
}: {
  readonly stage: Extract<Stage, { kind: "script" }>;
  readonly change: (changed: Stage) => void;
}): ReactNode {
  return (
    <>
      <Select
        label="Publishes"
        value={stage.publishTarget ?? "publishing-mode"}
        options={publishTargetSchema.options.map((target) => ({
          value: target,
          label: PUBLISH_TARGET_NAMES[target],
        }))}
        onChange={(target) => {
          const chosen = publishTargetSchema.options.find((offered) => offered === target);
          if (chosen) change({ ...stage, publishTarget: chosen });
        }}
      />
      {stage.publishTarget !== "branch-only" && (
        <Select
          label="After a conflict"
          hint="The Task's person resolves it and the Project's Test runs first"
          value={stage.afterConflict ?? "publish"}
          options={afterConflictSchema.options.map((afterConflict) => ({
            value: afterConflict,
            label: AFTER_CONFLICT_NAMES[afterConflict],
          }))}
          onChange={(afterConflict) => {
            const chosen = afterConflictSchema.options.find((offered) => offered === afterConflict);
            if (chosen) change({ ...stage, afterConflict: chosen });
          }}
        />
      )}
    </>
  );
}

/**
 * The command a Script Stage runs: one the choices offer, or, in the library, another key typed in,
 * which the Stage takes once it follows the key rules (spec §2.1).
 */
function CommandFields({
  stage,
  change,
  source,
}: {
  readonly stage: ScriptStage;
  readonly change: (changed: Stage) => void;
  readonly source: StageCommandSource;
}): ReactNode {
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState("");
  const typedKey = scriptStageCommandSchema.safeParse(typed.trim());
  return (
    <>
      <Select
        label="Project command"
        hint="Runs with no Agent; the result is recorded"
        value={typing ? ANOTHER_KEY : stage.command}
        options={commandChoices(stage.command, source)}
        onChange={(command) => {
          setTyping(command === ANOTHER_KEY);
          if (command === ANOTHER_KEY) setTyped("");
          else change(withCommand(stage, command));
        }}
      />
      {typing && (
        <Input
          label="Command key"
          hint="Lower-case letters, digits and -, as the Project's commands name it"
          autoFocus
          value={typed}
          error={
            typed.trim() === "" || typedKey.success
              ? undefined
              : `"${typed.trim()}" isn't a command key: lower-case letters, digits and -, starting with a letter, and not install.`
          }
          onChange={(event) => {
            setTyped(event.target.value);
            const parsed = scriptStageCommandSchema.safeParse(event.target.value.trim());
            if (parsed.success) change(withCommand(stage, parsed.data));
          }}
        />
      )}
    </>
  );
}

/** The Role whose card the Stage narrows: the one it names, or its duty's holder's. */
function workingRoleKey(stage: AgentStage, duties: readonly Duty[]): string | undefined {
  const worker = stageWorker(stage);
  if (worker === undefined) return undefined;
  return "role" in worker ? worker.role : dutyHolder(worker.duty, duties)?.roleKey;
}

function roleTitle(roleKey: string, options: RoleCardOptions): string {
  return options.knownRoles.find(({ key }) => key === roleKey)?.title ?? roleKey;
}

/** Why the Role a Stage names, though nobody can work it, still shows in the "Who works it" list. */
function unavailableLabel(
  roleKey: string,
  current: Role | undefined,
  options: RoleCardOptions,
): string {
  if (!current) return `${roleTitle(roleKey, options)} (nobody fills it)`;
  const { name, title } = current.card;
  return `${name} · ${title} (${current.letGoAt ? "let go" : "talks only"})`;
}
