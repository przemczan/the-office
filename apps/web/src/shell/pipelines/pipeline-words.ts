import type {
  AfterConflict,
  Duty,
  DutyKey,
  ProjectCommand,
  PublishTarget,
  Role,
  Stage,
  StageChange as ProjectStageChange,
  StagePermissions,
} from "@the-office/contracts";
import { DUTY_LABELS, dutyHolder } from "../duty-words.ts";
import { EFFORT_LABELS } from "../engine-words.ts";
import { editLabel, hardSwitchValueLabel, RUN_LABELS, webLabel } from "../role-card-words.ts";
import { commandWords, PUBLISH_COMMAND } from "./stage-commands.ts";
import { stageWorker } from "./stage-edits.ts";

export const PUBLISH_TARGET_NAMES: Readonly<Record<PublishTarget, string>> = {
  "publishing-mode": "By the Project's publishing mode",
  "branch-only": "Push the branch only (proof of concept)",
};

export const AFTER_CONFLICT_NAMES: Readonly<Record<AfterConflict, string>> = {
  publish: "Publish automatically",
  review: "Wait at a Gate for your review",
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
    words: (stage, roles, duties) => whoWorks(stage, roles, undefined, duties),
  },
  { label: "Session", words: (stage) => agentOnly(stage, ({ session }) => SESSION_NAMES[session]) },
  { label: "Budget", words: (stage) => agentOnly(stage, ({ budget }) => budgetWords(budget)) },
  {
    label: "Effort",
    words: (stage) =>
      agentOnly(stage, ({ effort }) => (effort ? EFFORT_LABELS[effort] : "Role default")),
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
  {
    label: "After a conflict",
    words: (stage) =>
      publishOnly(stage, ({ afterConflict }) => AFTER_CONFLICT_NAMES[afterConflict ?? "publish"]),
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
  words: (stage: Extract<Stage, { kind: "script" }>) => string,
): string | undefined {
  return stage.kind === "script" && stage.command === PUBLISH_COMMAND ? words(stage) : undefined;
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
 * Who works the Stage, as its row says: the Role's person, the duty with its holder ("Implements ·
 * Ada"), its command (by its name when `commands` has its key, else the key), or "waits for you"
 * for a Gate.
 */
export function whoWorks(
  stage: Stage,
  roles: readonly Role[],
  commands?: readonly Pick<ProjectCommand, "key" | "name">[],
  duties: readonly Duty[] = [],
): string {
  if (stage.kind === "gate") return "waits for you";
  if (stage.kind === "script") return commandWords(stage.command, commands);
  const worker = stageWorker(stage);
  if (worker && "duty" in worker) return dutyWorkerWords(worker.duty, duties);
  return roles.find(({ key }) => key === stage.role)?.card.name ?? "nobody yet";
}

/** "Implements · Ada", or "Implements · nobody yet" while nobody holds the duty. */
function dutyWorkerWords(duty: DutyKey, duties: readonly Duty[]): string {
  return `${DUTY_LABELS[duty]} · ${dutyHolder(duty, duties)?.name ?? "nobody yet"}`;
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

/**
 * A Project Pipeline's Stage change in the editor's words, its Stage named `stageName`: "Inserts
 * Verify on Linux after Tests", "Replaces Tests with Lint", "Changes Implement", "Removes Tests", "Changes Review's routes".
 */
export function stageChangeLine(stageChange: ProjectStageChange, stageName: string): string {
  switch (stageChange.kind) {
    case "insert-before":
      return `Inserts ${stageChange.stage.name} before ${stageName}`;
    case "insert-after":
      return `Inserts ${stageChange.stage.name} after ${stageName}`;
    case "replace":
      return `Replaces ${stageName} with ${stageChange.stage.name}`;
    case "change":
      return `Changes ${stageName}`;
    case "remove":
      return `Removes ${stageName}`;
    case "change-routes":
      return `Changes ${stageName}'s routes`;
  }
}

/** Two Stage changes alike, the name each keeps for its words aside. */
export function sameStageChange(one: ProjectStageChange, other: ProjectStageChange): boolean {
  const { stageName: _one, ...oneUnnamed } = one;
  const { stageName: _other, ...otherUnnamed } = other;
  return JSON.stringify(oneUnnamed, sortedKeys) === JSON.stringify(otherUnnamed, sortedKeys);
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
