import {
  afterConflictSchema,
  effortSchema,
  publishTargetSchema,
  scriptStageCommandSchema,
  type Role,
  type RoleCardOptions,
  type Stage,
} from "@the-office/contracts";
import { Checkbox, Field, Input, Select, Textarea } from "@the-office/ui";
import { useState, type ReactNode } from "react";
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
  failureTargets,
  replaceStage,
  withCommand,
  withRole,
  type AgentStage,
  type ScriptStage,
} from "./stage-edits.ts";
import { StagePermissionFields } from "./stage-permission-fields.tsx";
import "./stage-editor.css";

/** The most times a failure may go back, as the click-through offers. */
const MOST_ROUNDS = 9;

/** A Select's value for "keep the Role's effort": the Stage leaves it out. */
const ROLE_DEFAULT = "";

/** The library's choices while the Projects load: Publish, and another key. */
const NO_PROJECTS: StageCommandSource = { kind: "library", projects: [] };

export interface StageFormProps {
  /** The list the Stage is in; a Stage template is a list of its one Stage. */
  readonly stages: readonly Stage[];
  readonly index: number;
  readonly onChange: (stages: readonly Stage[]) => void;
  /** Everyone hired, who may work an Agent Stage when their Task limit isn't none. */
  readonly roles: readonly Role[];
  readonly options: RoleCardOptions;
  /** What a Script Stage may run: the Task's Project's commands, or every Project's; none while loading. */
  readonly commands?: StageCommandSource;
  /** A Stage template's form has no "On failure": going back names an earlier Stage of a Pipeline. */
  readonly template?: boolean;
}

/**
 * One Stage's fields (spec §2.3), the same in the Stage editor and for a Stage template, each change
 * answering the list with the Stage replaced.
 */
export function StageForm(props: StageFormProps): ReactNode {
  const { stages, index } = props;
  const stage = stages[index];
  if (!stage) return null;
  return <StageFields {...props} stage={stage} />;
}

function StageFields(props: StageFormProps & { readonly stage: Stage }): ReactNode {
  const { stage, stages, index, onChange, template = false } = props;
  const change = (changed: Stage): void => onChange(replaceStage(stages, index, changed));
  return (
    <div className="stage-editor-form">
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
      {stage.kind !== "gate" && !template && (
        <div className="stage-editor-wide">
          <Field label="On failure">
            <FailureFields {...props} stage={stage} change={change} />
          </Field>
        </div>
      )}
      <div className="stage-editor-wide">
        <Checkbox
          label="Optional: skipped when the Definition of Done is already met"
          checked={stage.optional}
          onChange={(optional) => change({ ...stage, optional })}
        />
      </div>
    </div>
  );
}

/**
 * Who may work an Agent Stage: anyone hired with a Task limit. The current choice stays listed
 * when it no longer qualifies, so the problem shows instead of the Stage silently changing.
 */
function RoleSelect({
  stage,
  stages,
  index,
  roles,
  options,
  onChange,
}: StageFormProps & { readonly stage: AgentStage }): ReactNode {
  const working = roles.filter(({ card, letGoAt }) => card.taskLimit !== "none" && !letGoAt);
  const current = roles.find(({ key }) => key === stage.role);
  const choices = working.map(({ key, card }) => ({
    value: key,
    label: `${card.name} · ${card.title}`,
  }));
  if (stage.role !== "" && !working.some(({ key }) => key === stage.role)) {
    choices.push({ value: stage.role, label: unavailableLabel(stage.role, current, options) });
  }
  return (
    <Select
      label="Who works it"
      hint="Only people with a Task limit"
      placeholder="Choose…"
      value={stage.role}
      options={choices}
      onChange={(role) => onChange(replaceStage(stages, index, withRole(stages, index, role)))}
    />
  );
}

function AgentFields({
  stage,
  stages,
  index,
  roles,
  options,
  commands = NO_PROJECTS,
  change,
}: StageFormProps & {
  readonly stage: AgentStage;
  readonly change: (stage: Stage) => void;
}): ReactNode {
  const continuing = canContinue(stages, index);
  const role = roles.find(({ key }) => key === stage.role);
  return (
    <>
      <Select
        label="Session"
        hint={continuing ? undefined : "Continuing needs the same Role in the Stage before"}
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
        value={stage.effort ?? ROLE_DEFAULT}
        options={[
          { value: ROLE_DEFAULT, label: "Role default" },
          ...effortSchema.options.map((effort) => ({
            value: effort,
            label: EFFORT_LABELS[effort],
          })),
        ]}
        onChange={(effort) => change({ ...stage, effort: effortSchema.safeParse(effort).data })}
      />
      <div className="stage-editor-wide">
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

function FailureFields({
  stage,
  stages,
  index,
  change,
}: StageFormProps & {
  readonly stage: Exclude<Stage, { kind: "gate" }>;
  readonly change: (stage: Stage) => void;
}): ReactNode {
  const targets = failureTargets(stages, index);
  const onFailure = stage.onFailure;
  const choices = [
    { value: "", label: "Ask you" },
    ...targets.map(({ key, name }) => ({ value: key, label: `Go back to ${name}` })),
  ];
  if (onFailure && !targets.some(({ key }) => key === onFailure.goBackTo)) {
    const target = stages.find(({ key }) => key === onFailure.goBackTo);
    choices.push({
      value: onFailure.goBackTo,
      label: `Go back to ${target?.name ?? onFailure.goBackTo} (not earlier)`,
    });
  }
  return (
    <div className="stage-editor-failure">
      <Select
        aria-label="On failure"
        value={onFailure?.goBackTo ?? ""}
        options={choices}
        onChange={(goBackTo) =>
          change({
            ...stage,
            onFailure: goBackTo === "" ? undefined : { goBackTo, rounds: onFailure?.rounds ?? 2 },
          })
        }
      />
      {onFailure && (
        <>
          <span>at most</span>
          <Select
            aria-label="Rounds"
            value={String(onFailure.rounds)}
            options={Array.from({ length: MOST_ROUNDS }, (_unused, at) => String(at + 1))}
            onChange={(rounds) =>
              change({ ...stage, onFailure: { ...onFailure, rounds: Number(rounds) } })
            }
          />
          <span>{onFailure.rounds === 1 ? "time" : "times"}, then ask you</span>
        </>
      )}
    </div>
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
