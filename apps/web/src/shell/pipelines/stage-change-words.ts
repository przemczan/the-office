import type {
  Duty,
  ProjectCommand,
  ProjectPipeline,
  Role,
  Stage,
  StageChange,
} from "@the-office/contracts";
import { tokensShort } from "../conversation/context-words.ts";
import { EFFORT_LABELS } from "../engine-words.ts";
import {
  AFTER_CONFLICT_NAMES,
  PUBLISH_TARGET_NAMES,
  thousands,
  whoWorks,
} from "./pipeline-words.ts";
import { isStageField, type StageChangeRow, type StageField } from "./stage-change-edits.ts";
import { commandWords } from "./stage-commands.ts";

/**
 * A Project Pipeline's Stage changes in the editor's words (docs/design/project-pipelines.html):
 * each row's mark, Undo's words, a Change's fields beside the base Pipeline's values, and the
 * lines that count them. The Broken reasons are the service's own.
 */

/** "1 Stage change", "2 Stage changes". */
export function counted(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Each field a Change may give, as the Stage form labels it. */
export const STAGE_FIELD_LABELS: Readonly<Record<StageField, string>> = {
  name: "Name",
  role: "Who works it",
  duty: "Duty",
  command: "Project command",
  publishTarget: "Publishes",
  afterConflict: "After a conflict",
  session: "Session",
  budget: "Budget",
  effort: "Effort",
  brief: "Brief",
  permissions: "Permissions",
  contextLimits: "Context limits",
  onFailure: "On failure",
};

export const STAGE_CHANGE_KIND_NAMES: Readonly<Record<StageChange["kind"], string>> = {
  "insert-before": "Insert before",
  "insert-after": "Insert after",
  replace: "Replace",
  change: "Change",
  remove: "Remove",
  "change-routes": "Change routes",
};

/** A row's mark: where its Stage comes from, and the tone of its edge. */
export interface OriginWords {
  readonly tone: "plain" | "success" | "info" | "warning" | "neutral";
  readonly text: string;
}

/**
 * "From Full", "Inserted after Review & fix", "Replaces Tests", "Changed: Brief, Effort", "Routes
 * changed", "Changed: Brief, and its routes", "Removed".
 */
export function originWords(row: StageChangeRow, baseName: string): OriginWords {
  const { built, stageChange, routesChanged } = row;
  switch (built.origin) {
    case "base":
    case "changed": {
      const fields = changedFieldsWords(built.origin === "changed" ? built.changedFields : []);
      if (fields === "") {
        return routesChanged
          ? { tone: "warning", text: ROUTES_CHANGED }
          : { tone: "plain", text: `From ${baseName}` };
      }
      return {
        tone: "warning",
        text: `Changed: ${fields}${routesChanged ? ", and its routes" : ""}`,
      };
    }
    case "inserted":
      return {
        tone: "success",
        text:
          stageChange?.kind === "insert-before"
            ? `Inserted before ${stageChange.stageName ?? stageChange.stageKey}`
            : `Inserted after ${stageChange?.stageName ?? stageChange?.stageKey ?? baseName}`,
      };
    case "replaced":
      return { tone: "info", text: `Replaces ${stageChange?.stageName ?? built.baseStage?.name}` };
    case "removed":
      return { tone: "neutral", text: "Removed" };
  }
}

/** The mark of a Stage of the base Pipeline whose routes alone a Change routes changes. */
export const ROUTES_CHANGED = "Routes changed";

/** "Undo: give Review & fix Full's routes back"; an inserted Stage's "Undo: give … its routes back". */
export function routesUndoWords(stageName: string, baseName: string | undefined): string {
  return baseName === undefined
    ? `Undo: give ${stageName} its routes back`
    : `Undo: give ${stageName} ${baseName}'s routes back`;
}

/**
 * The label of `optional`, which the form no longer offers but a Change saved before may still
 * give: the service still draws a converted line's routes again from it, so its words name it.
 */
const OPTIONAL_LABEL = "Optional";

/** "Brief, Effort": the fields Changes gave a Stage, by their labels; one nobody knows left out. */
export function changedFieldsWords(fields: readonly string[]): string {
  return fields
    .flatMap((field) => {
      if (isStageField(field)) return [STAGE_FIELD_LABELS[field]];
      return field === "optional" ? [OPTIONAL_LABEL] : [];
    })
    .join(", ");
}

/** What Undo gives back, as its tooltip and name say it. */
export function undoWords(row: StageChangeRow, baseName: string): string {
  const { built, stageChange } = row;
  const named = stageChange?.stageName ?? built.baseStage?.name ?? built.stage.name;
  switch (built.origin) {
    case "inserted":
      return `Undo: take ${built.stage.name} out`;
    case "replaced":
      return `Undo: back to ${baseName}'s ${named}`;
    case "changed":
      return `Undo: back to ${baseName}'s ${named} as it is`;
    default:
      return `Undo: put ${baseName}'s ${named} back`;
  }
}

/** "Inserts Verify on Linux after Review & fix", "Changes Produce: Brief", in a line. */
export function stageChangeLine(stageChange: StageChange): string {
  const named = stageChange.stageName ?? stageChange.stageKey;
  switch (stageChange.kind) {
    case "insert-before":
      return `Inserts ${stageChange.stage.name} before ${named}`;
    case "insert-after":
      return `Inserts ${stageChange.stage.name} after ${named}`;
    case "replace":
      return `Replaces ${named} with ${stageChange.stage.name}`;
    case "change":
      return `Changes ${named}: ${changedFieldsWords(Object.keys(stageChange.fields))}`;
    case "remove":
      return `Removes ${named}`;
    case "change-routes":
      return `Changes ${named}'s routes`;
  }
}

/** What a field reads, given the Stage and the Stages its loop may name. */
export interface FieldWordsContext {
  readonly roles: readonly Role[];
  /** Who holds each duty, for a Stage naming one; its label alone while they aren't read. */
  readonly duties?: readonly Duty[];
  readonly stages: readonly Stage[];
  readonly commands?: readonly Pick<ProjectCommand, "key" | "name">[];
}

/** A field's value in a Stage, as the compare table shows it; a field the Stage leaves out reads as its default. */
export function fieldWords(stage: Stage, field: StageField, context: FieldWordsContext): string {
  const value = (stage as Partial<Record<StageField, unknown>>)[field];
  switch (field) {
    case "role":
    case "duty":
      return stage.kind === "agent"
        ? whoWorks(stage, context.roles, undefined, context.duties)
        : "None";
    case "command":
      return stage.kind === "script" ? commandWords(stage.command, context.commands) : "None";
    case "publishTarget":
      return stage.kind === "script"
        ? PUBLISH_TARGET_NAMES[stage.publishTarget ?? "publishing-mode"]
        : "None";
    case "afterConflict":
      return stage.kind === "script"
        ? AFTER_CONFLICT_NAMES[stage.afterConflict ?? "publish"]
        : "None";
    case "session":
      if (stage.kind !== "agent") return "None";
      return stage.session === "fresh"
        ? "Fresh, with a brief"
        : "Continue the previous Stage's session";
    case "budget":
      return stage.kind === "agent" ? `${thousands(stage.budget)}k tokens` : "None";
    case "effort":
      if (stage.kind !== "agent") return "None";
      return stage.effort ? EFFORT_LABELS[stage.effort] : "Person's effort";
    case "permissions":
      return stage.kind === "agent" && stage.permissions ? "Narrowed" : "The Role card's";
    case "contextLimits":
      return stage.kind === "agent" ? contextLimitsWords(stage.contextLimits) : "None";
    case "onFailure":
      return onFailureWords(stage, context.stages);
    case "brief":
    case "name":
      return typeof value === "string" && value.trim() !== "" ? value : "None";
  }
}

function onFailureWords(stage: Stage, stages: readonly Stage[]): string {
  const onFailure = stage.kind === "gate" ? undefined : stage.onFailure;
  if (!onFailure) return "Ask you";
  const target = stages.find(({ key }) => key === onFailure.goBackTo)?.name ?? onFailure.goBackTo;
  return `Go back to ${target}, at most ${counted(onFailure.rounds, "time", "times")}`;
}

/** "5 Stages: Full's 4, with 2 Stage changes", or "Full's 4 Stages as they are: no Stage change yet". */
export function getsLine(
  stages: number,
  baseStages: number,
  baseName: string,
  stageChanges: number,
): string {
  if (stageChanges === 0) {
    return `${baseName}'s ${counted(baseStages, "Stage", "Stages")} as they are: no Stage change yet`;
  }
  return `${counted(stages, "Stage", "Stages")}: ${baseName}'s ${baseStages}, with ${counted(stageChanges, "Stage change", "Stage changes")}`;
}

/** A Project Pipeline's line in its Project's list: what it is built from, or why it is Broken. */
export function projectPipelineLine({
  basePipeline,
  stageChanges,
  broken,
}: ProjectPipeline): string {
  if (broken.length > 0) {
    return `Built from ${basePipeline.name} · ${counted(broken.length, "Stage change doesn't apply", "Stage changes don't apply")}`;
  }
  return `Built from ${basePipeline.name} · ${counted(stageChanges.length, "Stage change", "Stage changes")}`;
}

/** "Built on by 4 Project Pipelines". */
export function builtOnByWords(projectPipelines: number): string {
  return `Built on by ${counted(projectPipelines, "Project Pipeline", "Project Pipelines")}`;
}

/** An Agent Stage's context limits as the Stage form's choice names them. */
function contextLimitsWords(
  contextLimits: Extract<Stage, { kind: "agent" }>["contextLimits"],
): string {
  if (!contextLimits) return "Office default";
  if (contextLimits.kind === "none") return "No limit";
  const { soft, hard } = contextLimits.limits;
  return `Soft ${tokensShort(soft)}, hard ${tokensShort(hard)}`;
}
