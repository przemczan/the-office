import {
  effortSchema,
  publishTargetSchema,
  type PublishTarget,
  type Role,
  type RoleCardOptions,
  type Stage,
  type StageProblem,
} from "@the-office/contracts";
import {
  Alert,
  Button,
  Checkbox,
  Field,
  Icon,
  IconButton,
  Input,
  Select,
  Textarea,
} from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { EFFORT_LABELS, modelLabel } from "../engine-words.ts";
import {
  addStage,
  canContinue,
  canMove,
  failureTargets,
  moveStage,
  removeStage,
  replaceStage,
  STAGE_COMMANDS,
  STAGE_KIND_NAMES,
  withCommand,
  withRole,
  type AgentStage,
  type StageCommand,
  type StageKind,
} from "./stage-edits.ts";
import "./stage-editor.css";

const KIND_ICONS: Readonly<Record<StageKind, string>> = {
  agent: "user",
  script: "terminal",
  gate: "hand",
};

const COMMAND_NAMES: Readonly<Record<StageCommand, string>> = {
  test: "Test",
  lint: "Lint",
  build: "Build",
  publish: "Publish",
};

const PUBLISH_TARGET_NAMES: Readonly<Record<PublishTarget, string>> = {
  "publishing-mode": "By the Project's publishing mode",
  "branch-only": "Push the branch only (proof of concept)",
};

/** The most times a failure may go back, as the click-through offers. */
const MOST_ROUNDS = 9;

/** A Select's value for "keep the Role's model or effort": the Stage leaves it out. */
const ROLE_DEFAULT = "";

export interface StageEditorProps {
  readonly stages: readonly Stage[];
  readonly onChange: (stages: readonly Stage[]) => void;
  /**
   * Where each Stage that has started stands, from the first: those are locked. Empty for a
   * library Pipeline, which no Task walks.
   */
  readonly lockedNotes: readonly string[];
  /** What saving would be refused for, from the service. */
  readonly problems: readonly StageProblem[];
  /** Everyone hired, who may work an Agent Stage when their Task limit isn't none. */
  readonly roles: readonly Role[];
  readonly options: RoleCardOptions;
  /** What each command runs in the Task's Project; absent where each Project runs its own. */
  readonly commandLines?: Readonly<Record<StageCommand, string>>;
}

/**
 * The Stage editor (spec §2.3): a Pipeline's Stages to add, drop, reorder and set, one open at a
 * time, with what the service would refuse flagged on its Stage. One editor serves "Edit for this
 * Task" and the library.
 */
export function StageEditor(props: StageEditorProps): ReactNode {
  const { stages, onChange, lockedNotes, problems } = props;
  const [open, setOpen] = useState<number | undefined>();
  const lockedStages = lockedNotes.length;
  const flagged = new Set(problems.map(({ stageIndex }) => stageIndex));
  return (
    <div className="stage-editor">
      {problems.length > 0 && (
        <Alert tone="warning" title="These Stages can't be saved yet">
          <ul className="refusal-reasons" aria-label="Problems">
            {problems.map(({ text }) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
        </Alert>
      )}
      <ol className="stage-editor-stages" aria-label="Stages">
        {stages.map((stage, index) => (
          <StageEditorRow
            key={stage.key}
            {...props}
            index={index}
            lockedNote={lockedNotes[index]}
            flagged={flagged.has(index)}
            open={open === index}
            onToggle={() => setOpen(open === index ? undefined : index)}
            onMove={(by) => {
              onChange(moveStage(stages, index, by, lockedStages));
              if (open === index) setOpen(index + by);
            }}
            onRemove={() => {
              onChange(removeStage(stages, index));
              setOpen(undefined);
            }}
          />
        ))}
      </ol>
      <div className="stage-editor-add">
        <span>Add</span>
        {(["agent", "script", "gate"] as const).map((kind) => (
          <Button
            key={kind}
            size="sm"
            variant="secondary"
            iconLeft={<Icon name={KIND_ICONS[kind]} size={14} />}
            onClick={() => {
              const added = addStage(stages, kind, lockedStages);
              onChange(added.stages);
              setOpen(added.index);
            }}
          >
            {STAGE_KIND_NAMES[kind]}
          </Button>
        ))}
      </div>
      <p className="stage-editor-rules">
        <Icon name="info" size={14} />
        Whatever the Pipeline, you are always asked when a round or budget limit is reached, a Stage
        fails with no retries left, the Definition of Done is not met after the last review, or an
        Agent reaches a hard switch.
      </p>
    </div>
  );
}

interface StageEditorRowProps extends StageEditorProps {
  readonly index: number;
  readonly lockedNote: string | undefined;
  readonly flagged: boolean;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly onMove: (by: -1 | 1) => void;
  readonly onRemove: () => void;
}

function StageEditorRow(props: StageEditorRowProps): ReactNode {
  const { stages, index, lockedNote, flagged, open, onToggle, onMove, onRemove } = props;
  const stage = stages[index];
  if (!stage) return null;
  const locked = lockedNote !== undefined;
  const lockedStages = props.lockedNotes.length;
  const name = stage.name.trim() || STAGE_KIND_NAMES[stage.kind];
  const classes = [
    "stage-editor-row",
    locked && "stage-editor-row-locked",
    open && "stage-editor-row-open",
    flagged && "stage-editor-row-flagged",
  ].filter(Boolean);
  return (
    <li className={classes.join(" ")} aria-label={name}>
      <span className="stage-editor-kind" title={STAGE_KIND_NAMES[stage.kind]}>
        <Icon name={KIND_ICONS[stage.kind]} size={13} />
      </span>
      <div className="stage-editor-body">
        <button
          type="button"
          className="stage-editor-head"
          disabled={locked}
          aria-expanded={open}
          onClick={onToggle}
        >
          <StageSummary {...props} stage={stage} name={name} />
          {locked && <div className="stage-editor-detail">{lockedNote}</div>}
        </button>
        {open && !locked && <StageForm {...props} stage={stage} />}
      </div>
      {locked ? (
        <span className="stage-editor-lock" title="Already started">
          <Icon name="lock" size={14} />
        </span>
      ) : (
        <span className="stage-editor-tools">
          <IconButton
            size="sm"
            icon={<Icon name="arrow-up" size={14} />}
            label={`Move ${name} up`}
            disabled={!canMove(stages, index, -1, lockedStages)}
            onClick={() => onMove(-1)}
          />
          <IconButton
            size="sm"
            icon={<Icon name="arrow-down" size={14} />}
            label={`Move ${name} down`}
            disabled={!canMove(stages, index, 1, lockedStages)}
            onClick={() => onMove(1)}
          />
          <IconButton
            size="sm"
            icon={<Icon name={open ? "chevron-up" : "pencil"} size={14} />}
            label={open ? `Done editing ${name}` : `Edit ${name}`}
            onClick={onToggle}
          />
          <IconButton
            size="sm"
            icon={<Icon name="trash-2" size={14} />}
            label={`Remove ${name}`}
            onClick={onRemove}
          />
        </span>
      )}
    </li>
  );
}

/** "Implement · Ada" over "fresh session · 250k budget · on failure back to …". */
function StageSummary({
  stage,
  stages,
  name,
  roles,
  commandLines,
}: StageEditorProps & { readonly stage: Stage; readonly name: string }): ReactNode {
  const onFailure = stage.kind !== "gate" ? stage.onFailure : undefined;
  const target = onFailure && stages.find(({ key }) => key === onFailure.goBackTo);
  const details = [
    stage.kind === "agent" &&
      (stage.session === "continue" ? "continues the session" : "fresh session"),
    stage.kind === "agent" && `${thousands(stage.budget)}k budget`,
    stage.kind === "agent" && stage.model !== undefined && modelLabel(stage.model),
    stage.kind === "agent" &&
      stage.effort !== undefined &&
      `effort ${EFFORT_LABELS[stage.effort].toLowerCase()}`,
    stage.optional && "optional",
    onFailure &&
      `on failure back to ${target?.name ?? onFailure.goBackTo}, at most ${onFailure.rounds}×`,
  ].filter((detail) => typeof detail === "string");
  return (
    <>
      <div className="stage-editor-name">
        {name} <span className="stage-editor-who">· {whoWorks(stage, roles, commandLines)}</span>
      </div>
      {details.length > 0 && <div className="stage-editor-detail">{details.join(" · ")}</div>}
    </>
  );
}

function whoWorks(
  stage: Stage,
  roles: readonly Role[],
  commandLines: StageEditorProps["commandLines"],
): string {
  if (stage.kind === "gate") return "waits for you";
  if (stage.kind === "script") return commandLines?.[stage.command] ?? COMMAND_NAMES[stage.command];
  return roles.find(({ key }) => key === stage.role)?.card.name ?? "nobody yet";
}

function StageForm(props: StageEditorRowProps & { readonly stage: Stage }): ReactNode {
  const { stage, stages, index, onChange } = props;
  const change = (changed: Stage): void => onChange(replaceStage(stages, index, changed));
  return (
    <div className="stage-editor-form">
      <Input
        label="Name"
        value={stage.name}
        onChange={(event) => change({ ...stage, name: event.target.value })}
      />
      {stage.kind === "agent" && <RoleSelect {...props} stage={stage} />}
      {stage.kind === "script" && (
        <Select
          label="Project command"
          hint="Runs with no Agent; the result is recorded"
          value={stage.command}
          options={STAGE_COMMANDS.map((command) => ({
            value: command,
            label: commandChoice(command, props.commandLines),
          }))}
          onChange={(command) => {
            const chosen = STAGE_COMMANDS.find((offered) => offered === command);
            if (chosen) change(withCommand(stage, chosen));
          }}
        />
      )}
      {stage.kind === "script" && stage.command === "publish" && (
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
      )}
      {stage.kind === "gate" && (
        <Input
          label="What you see"
          disabled
          value="The diff, results, Attachments and screenshots so far"
        />
      )}
      {stage.kind === "agent" && <AgentFields {...props} stage={stage} change={change} />}
      {stage.kind !== "gate" && (
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
}: StageEditorRowProps & { readonly stage: AgentStage }): ReactNode {
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
  change,
}: StageEditorRowProps & {
  readonly stage: AgentStage;
  readonly change: (stage: Stage) => void;
}): ReactNode {
  const continuing = canContinue(stages, index);
  const engine = roles.find(({ key }) => key === stage.role)?.card.engine;
  const models =
    options.engines.find((offered) => offered.engine === engine)?.models ??
    options.engines.flatMap((offered) => offered.models);
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
        label="Model"
        value={stage.model ?? ROLE_DEFAULT}
        options={[
          { value: ROLE_DEFAULT, label: "Role default" },
          ...models.map((model) => ({ value: model, label: modelLabel(model) })),
        ]}
        onChange={(model) =>
          change({ ...stage, model: model === ROLE_DEFAULT ? undefined : model })
        }
      />
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
        if (event.target.value !== "" && budget > 0) change({ ...stage, budget });
      }}
    />
  );
}

function FailureFields({
  stage,
  stages,
  index,
  change,
}: StageEditorRowProps & {
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

function commandChoice(
  command: StageCommand,
  commandLines: StageEditorProps["commandLines"],
): string {
  if (commandLines === undefined) return `${COMMAND_NAMES[command]} (each Project's own command)`;
  const line = commandLines[command];
  return `${COMMAND_NAMES[command]} · ${line === "" ? "not set" : line}`;
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

function thousands(tokens: number): number {
  return Math.round(tokens / 1000);
}
