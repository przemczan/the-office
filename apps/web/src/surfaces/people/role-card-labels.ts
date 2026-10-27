import {
  effortSchema,
  engineSchema,
  sessionDefaultSchema,
  type Capabilities,
  type Engine,
  type HardSwitchKey,
  type HardSwitchValue,
  type PermissionProfile,
  type RoleCardField,
  type RoleCardOptions,
  type RoleChange,
  type RunPermission,
  type SessionDefault,
  type TaskLimit,
} from "@the-office/contracts";
import type { z } from "zod";
import { EFFORT_LABELS, modelLabel } from "../../shell/engine-words.ts";

/** The words People shows a Role card in, the click-through's (prototypes/app/people.js). */

export interface CapabilityInfo {
  readonly key: keyof Capabilities;
  readonly label: string;
  readonly icon: string;
  readonly hint: string;
}

export const CAPABILITIES: readonly CapabilityInfo[] = [
  {
    key: "sharedMemory",
    label: "Shared memory",
    icon: "brain",
    hint: "Remembers across Tasks and conversations",
  },
  { key: "chat", label: "Chat", icon: "message-circle", hint: "You can open a chat at any time" },
  {
    key: "consultant",
    label: "Consultant",
    icon: "life-buoy",
    hint: "Other Agents may consult them on a Task",
  },
];

export const ENGINE_LABELS: Readonly<Record<Engine, string>> = { "agent-sdk": "Agent SDK" };

export const SESSION_DEFAULTS: Readonly<
  Record<SessionDefault, { readonly label: string; readonly description: string }>
> = {
  "context-policy": {
    label: "Context policy",
    description: "Continues while the cache is warm or the context small, else starts fresh",
  },
  "always-start-fresh": {
    label: "Always start fresh",
    description: "Starts fresh with a Brief once the cache has cooled",
  },
  "prefer-to-continue": {
    label: "Prefer to continue",
    description: "Continues the Thread's session even once the cache has cooled",
  },
};

export const HARD_SWITCH_LABELS: Readonly<Record<HardSwitchKey, string>> = {
  runInstalls: "Run installs",
  publishOutsideThePipeline: "Publish outside the Pipeline",
  changeRoles: "Change Roles",
};

export const ENFORCEMENT_LABELS = {
  enforced: "Enforced by The Office",
  followed: "Followed by the Agent",
} as const;

/** What a Consult value naming a Role nobody fills does for now. */
export const ASKS_YOU_UNTIL_HIRED = "Asks you until someone is hired";

export const RUN_LABELS: Readonly<Record<RunPermission, string>> = {
  "read-only-git": "Runs read-only git only",
  "project-commands": "Runs the Project's commands and read-only git",
  anything: "Runs any command; git read-only",
};

const FIELD_LABELS: Readonly<Record<RoleCardField, string>> = {
  name: "Name",
  title: "Title",
  responsibilities: "Responsibilities",
  instructions: "Instructions",
  engine: "Engine",
  model: "Model",
  effort: "Effort",
  taskLimit: "Task limit",
  sessionDefault: "Session default",
  "capabilities.sharedMemory": "Shared memory",
  "capabilities.chat": "Chat",
  "capabilities.consultant": "Consultant",
  permissionProfile: "Permission profile",
  "hardSwitches.runInstalls": HARD_SWITCH_LABELS.runInstalls,
  "hardSwitches.publishOutsideThePipeline": HARD_SWITCH_LABELS.publishOutsideThePipeline,
  "hardSwitches.changeRoles": HARD_SWITCH_LABELS.changeRoles,
};

/** Too long to show both versions in a line of the change history. */
const LONG_TEXT_FIELDS: ReadonlySet<RoleCardField> = new Set(["responsibilities", "instructions"]);

/** Each Role's title by its key, as Consult values name them. */
export type RoleTitles = ReadonlyMap<string, string>;

export function roleTitlesOf(options: RoleCardOptions): RoleTitles {
  return new Map(options.knownRoles.map(({ key, title }) => [key, title]));
}

/** "Opus 5.5" for the engine's "claude-opus-5-5"; an id of another shape as it is. */
export function taskLimitLabel(limit: TaskLimit): string {
  return limit === "none" ? "None: talks only and never works a Stage" : `${limit} at once`;
}

/** The Task limit in a few words, for a person's card. */
export function taskLimitShort(limit: TaskLimit): string {
  if (limit === "none") return "Talks only";
  return `Up to ${limit} ${limit === 1 ? "Task" : "Tasks"}`;
}

export function hardSwitchValueLabel(value: HardSwitchValue, roleTitles: RoleTitles): string {
  switch (value.kind) {
    case "allowed":
      return "Allowed";
    case "consult":
      return `Consult ${roleTitles.get(value.role) ?? value.role}`;
    case "ask-me":
      return "Ask me";
    case "never":
      return "Never";
  }
}

/** The profile as lines: what the Agent edits, runs and reaches. */
export function permissionProfileLines(profile: PermissionProfile): string[] {
  return [
    profile.edit ? "Edits files in its worktree" : "Reads files only",
    RUN_LABELS[profile.run],
    profile.web ? "Searches and fetches the web" : "No web",
  ];
}

type FieldChange = Extract<RoleChange, { kind: "card-changed" }>["changes"][number];

/** One line of the change history, such as "Model Opus 5.5 → Sonnet 5.5". */
export function changeLine(change: FieldChange, roleTitles: RoleTitles): string {
  const label = FIELD_LABELS[change.field];
  if (LONG_TEXT_FIELDS.has(change.field)) return `${label} edited`;
  return `${label} ${valueText(change.field, change.from, roleTitles)} → ${valueText(change.field, change.to, roleTitles)}`;
}

/** What a skills change gave and took, such as "Skills gained release-notes; lost tdd". */
export function skillsChangeLine({
  added,
  removed,
}: Extract<RoleChange, { kind: "skills-changed" }>): string {
  const parts = [
    ...(added.length > 0 ? [`gained ${added.join(", ")}`] : []),
    ...(removed.length > 0 ? [`lost ${removed.join(", ")}`] : []),
  ];
  return `Skills ${parts.join("; ")}`;
}

function valueText(field: RoleCardField, value: FieldChange["to"], roleTitles: RoleTitles): string {
  if (typeof value === "boolean") return value ? "on" : "off";
  if (typeof value === "number") return String(value);
  if (typeof value === "object") {
    return "kind" in value
      ? hardSwitchValueLabel(value, roleTitles)
      : permissionProfileLines(value).join(", ");
  }
  switch (field) {
    case "model":
      return modelLabel(value);
    case "engine":
      return labelIn(engineSchema, (engine) => ENGINE_LABELS[engine], value);
    case "effort":
      return labelIn(effortSchema, (effort) => EFFORT_LABELS[effort], value);
    case "sessionDefault":
      return labelIn(sessionDefaultSchema, (choice) => SESSION_DEFAULTS[choice].label, value);
    default:
      return value;
  }
}

/** The label of `value` when the schema knows it; an older card's value as it was kept. */
function labelIn<Value extends string>(
  schema: z.ZodType<Value>,
  labelOf: (known: Value) => string,
  value: string,
): string {
  const known = schema.safeParse(value);
  return known.success ? labelOf(known.data) : value;
}
