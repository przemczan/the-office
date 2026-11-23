import type {
  Duty,
  DutyKey,
  ProjectCommand,
  ProjectPipeline,
  PublishResult,
  PublishTarget,
  Role,
  Stage,
  StagePermissions,
} from "@the-office/contracts";
import { DUTY_LABELS, dutyHolder } from "../duty-words.ts";
import { EFFORT_LABELS } from "../engine-words.ts";
import { editLabel, hardSwitchValueLabel, RUN_LABELS, webLabel } from "../role-card-words.ts";
import { dayOf } from "../time.ts";
import { commandWords } from "./stage-commands.ts";
import { stageWorker } from "./stage-edits.ts";

export const PUBLISH_TARGET_NAMES: Readonly<Record<PublishTarget, string>> = {
  "publishing-mode": "By the Project's publishing mode",
  "branch-only": "Push the branch only (proof of concept)",
};

/** A Publish Stage's results (spec §2.3.4, "Publish's results"), as its routes and runs name them. */
export const PUBLISH_RESULT_NAMES: Readonly<Record<PublishResult, string>> = {
  published: "Published",
  "nothing-to-publish": "Nothing to publish",
  conflict: "Conflict",
  "after-publishing-failed": "After publishing failed",
  failed: "Failed",
};

/** A Publish Stage's second line on the canvas and its rows: what it does, by its target. */
export const PUBLISH_TARGET_WORDS: Readonly<Record<PublishTarget, string>> = {
  "publishing-mode": "publishes by the Project's mode",
  "branch-only": "pushes the branch only",
};

const SESSION_NAMES: Readonly<Record<Extract<Stage, { kind: "agent" }>["session"], string>> = {
  fresh: "Fresh, with a brief",
  continue: "Continue the previous Stage's session",
};

/** What a field reads in a Stage, as its editor labels it; undefined where its kind has none. */
type StageFieldWords = (
  stage: Stage,
  roles: readonly Role[],
  duties: readonly Duty[],
) => string | undefined;

/** A Stage's fields as its editor names them, in its order. */
const STAGE_FIELDS: readonly { readonly label: string; readonly words: StageFieldWords }[] = [
  { label: "Name", words: ({ name }) => name },
  {
    label: "Who works it",
    // A Publish Stage's line is its Publishes field's, said there.
    words: (stage, roles, duties) =>
      stage.kind === "publish" ? undefined : whoWorks(stage, roles, undefined, duties),
  },
  { label: "Session", words: (stage) => agentOnly(stage, ({ session }) => SESSION_NAMES[session]) },
  { label: "Budget", words: (stage) => agentOnly(stage, ({ budget }) => budgetWords(budget)) },
  {
    label: "Effort",
    words: (stage) =>
      agentOnly(stage, ({ effort }) => (effort ? EFFORT_LABELS[effort] : "Person's effort")),
  },
  {
    label: "Merge the base first",
    words: (stage) => agentOnly(stage, ({ mergeBaseFirst }) => (mergeBaseFirst ? "On" : "Off")),
  },
  { label: "Brief", words: (stage) => agentOnly(stage, ({ brief }) => brief) },
  {
    label: "Permissions",
    words: (stage, roles) =>
      agentOnly(stage, ({ permissions }) => permissionsWords(permissions, roles)),
  },
  {
    label: "Publishes",
    words: (stage) =>
      publishOnly(
        stage,
        ({ publishTarget }) => PUBLISH_TARGET_NAMES[publishTarget ?? "publishing-mode"],
      ),
  },
];

/** A field of a Stage from one value to another, in the editor's words. */
export interface StageFieldChange {
  readonly label: string;
  readonly from: string;
  readonly to: string;
}

/** The fields a change of one Stage rewrites; a field its kind lacks reads "None". */
export function stageFieldChanges(
  from: Stage,
  to: Stage,
  roles: readonly Role[],
  duties: readonly Duty[] = [],
): StageFieldChange[] {
  return STAGE_FIELDS.flatMap(({ label, words }) => {
    const before = words(from, roles, duties) ?? "None";
    const after = words(to, roles, duties) ?? "None";
    return before === after ? [] : [{ label, from: before, to: after }];
  });
}

function agentOnly(
  stage: Stage,
  words: (stage: Extract<Stage, { kind: "agent" }>) => string,
): string | undefined {
  return stage.kind === "agent" ? words(stage) : undefined;
}

function publishOnly(
  stage: Stage,
  words: (stage: Extract<Stage, { kind: "publish" }>) => string,
): string | undefined {
  return stage.kind === "publish" ? words(stage) : undefined;
}

function budgetWords(budget: number): string {
  return `${thousands(budget)}k tokens`;
}

/**
 * What a Stage narrows of its Role card's permission profile, or that it keeps the card's. Each
 * MCP tool is named with its setting, so a change of one tool alone still reads as a change.
 */
function permissionsWords(
  permissions: StagePermissions | undefined,
  roles: readonly Role[],
): string {
  const roleTitles = new Map(roles.map(({ key, card }) => [key, card.title]));
  const narrowed = [
    ...(permissions?.edit === false ? [editLabel(false)] : []),
    ...(permissions?.run ? [RUN_LABELS[permissions.run]] : []),
    ...(permissions?.web === false ? [webLabel(false)] : []),
    ...Object.entries(permissions?.mcpTools ?? {})
      .toSorted(([one], [other]) => one.localeCompare(other))
      .map(([tool, value]) => `${tool}: ${hardSwitchValueLabel(value, roleTitles)}`),
    ...(permissions?.commands ? [`Project commands: ${permissions.commands.join(", ")}`] : []),
  ];
  return narrowed.length > 0 ? narrowed.join("; ") : "The Role card's";
}

/** The Stages in order, as the library's list shows them: "Implement → Tests → Publish". */
export function stagesLine({ stages }: { readonly stages: readonly Stage[] }): string {
  return stages.map(({ name }) => name).join(" → ");
}

/**
 * Where a Project Pipeline was copied from, for its words alone: "Copied from Full on 12 Nov", or
 * "Copied from Full" for one the update moved, which has no date.
 */
export function copiedFromWords(
  { name, at }: ProjectPipeline["copiedFrom"],
  now: Date = new Date(),
): string {
  return at === null ? `Copied from ${name}` : `Copied from ${name} on ${dayOf(at, now)}`;
}

/**
 * Who works the Stage, as its row says: the Role's person, the duty with its holder ("Implements ·
 * Ada"), its command (by its name when `commands` has its key, else the key), "waits for you" for a
 * Gate, or what a Publish Stage does ("publishes by the Project's mode", "pushes the branch only").
 */
export function whoWorks(
  stage: Stage,
  roles: readonly Role[],
  commands?: readonly Pick<ProjectCommand, "key" | "name">[],
  duties: readonly Duty[] = [],
): string {
  if (stage.kind === "gate") return "waits for you";
  if (stage.kind === "script") return commandWords(stage.command, commands);
  if (stage.kind === "publish")
    return PUBLISH_TARGET_WORDS[stage.publishTarget ?? "publishing-mode"];
  const worker = stageWorker(stage);
  if (worker && "duty" in worker) return dutyWorkerWords(worker.duty, duties);
  return roles.find(({ key }) => key === stage.role)?.card.name ?? "nobody yet";
}

/** "Implements · Ada", or "Implements · nobody yet" while nobody holds the duty. */
function dutyWorkerWords(duty: DutyKey, duties: readonly Duty[]): string {
  return `${DUTY_LABELS[duty]} · ${dutyHolder(duty, duties)?.name ?? "nobody yet"}`;
}

/** "1 Stage" or "3 Stages": a count with its noun in the singular or plural. */
export function counted(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Tokens in thousands, as a budget is typed and shown. */
export function thousands(tokens: number): number {
  return Math.round(tokens / 1000);
}

/** How a Stage fares in a change of a Pipeline's Stages, by its key. */
export interface StageChange {
  readonly name: string;
  readonly change: "added" | "removed" | "changed";
}

/** The Stages a change adds, removes or rewrites, by key, in the order the new Stages have them. */
export function stageChanges(from: readonly Stage[], to: readonly Stage[]): StageChange[] {
  const before = new Map(from.map((stage) => [stage.key, stage]));
  const kept = new Set(to.map(({ key }) => key));
  return [
    ...to.flatMap((stage): StageChange[] => {
      const was = before.get(stage.key);
      if (!was) return [{ name: stage.name, change: "added" }];
      return sameStage(was, stage) ? [] : [{ name: stage.name, change: "changed" }];
    }),
    ...from
      .filter(({ key }) => !kept.has(key))
      .map(({ name }): StageChange => ({ name, change: "removed" })),
  ];
}

function sameStage(one: Stage, other: Stage): boolean {
  return JSON.stringify(one, sortedKeys) === JSON.stringify(other, sortedKeys);
}

/** Fields in one order, so two Stages alike read alike whatever order their fields came in. */
function sortedKeys(_key: string, value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(
    Object.entries(value).toSorted(([one], [other]) => one.localeCompare(other)),
  );
}
