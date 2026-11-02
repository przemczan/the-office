import {
  effortSchema,
  sessionDefaultSchema,
  type Capabilities,
  type EngineCapability,
  type HardSwitchKey,
  type HardSwitchValue,
  type PermissionProfile,
  type ProposedChange,
  type RoleCardField,
  type RoleCardOptions,
  type RoleChange,
  type RunPermission,
  type SessionDefault,
  type TaskLimit,
} from "@the-office/contracts";
import type { z } from "zod";
import { EFFORT_LABELS, modelLabel } from "./engine-words.ts";

/**
 * The words a Role card is shown in, the click-through's (prototypes/app/people.js): on People, and
 * in a chat's Proposal card.
 */

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

/** What the card says, under its Engine field, of each thing the engine declares it can't do. */
const MISSING_CAPABILITY_WORDS: Readonly<Record<EngineCapability, string>> = {
  bargeIn: "A message sent while it works waits for the turn to end.",
  interrupt: "Stop can't end a running turn.",
  resume: "A Thread can't continue its session once it ends, so it starts fresh.",
  usageWindows: "It has no usage windows, so the 5-hour window doesn't count it.",
  contextUsage: "It can't tell how full its context is, so the Context policy can't weigh it.",
  officeTools: "It can't use Office tools.",
  outputSchema: "It can't hold a Stage's answer to a schema.",
};

/** The words for what an engine can't do; undefined when it can do everything. */
export function missingCapabilitiesWords(missing: readonly EngineCapability[]): string | undefined {
  if (missing.length === 0) return undefined;
  return missing.map((capability) => MISSING_CAPABILITY_WORDS[capability]).join(" ");
}

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

/** A switch's value as one choice of a select: "consult:devops" for Consult Devops. */
const CONSULT_CHOICE = "consult:";

export function hardSwitchChoiceOf(value: HardSwitchValue): string {
  return value.kind === "consult" ? `${CONSULT_CHOICE}${value.role}` : value.kind;
}

export function hardSwitchValueOf(choice: string): HardSwitchValue {
  if (choice.startsWith(CONSULT_CHOICE)) {
    return { kind: "consult", role: choice.slice(CONSULT_CHOICE.length) };
  }
  if (choice === "allowed" || choice === "ask-me" || choice === "never") return { kind: choice };
  throw new Error(`No Hard switch value is chosen as ${choice}.`);
}

/**
 * A Hard switch's or an MCP tool's choices, as a select offers them: Allowed, Consult each Role of
 * `consultable`, Ask me, Never.
 */
export function hardSwitchChoices(
  consultable: readonly { readonly key: string; readonly title: string }[],
): { value: string; label: string }[] {
  return [
    { value: "allowed", label: "Allowed" },
    ...consultable.map(({ key, title }) => ({
      value: hardSwitchChoiceOf({ kind: "consult", role: key }),
      label: `Consult ${title}`,
    })),
    { value: "ask-me", label: "Ask me" },
    { value: "never", label: "Never" },
  ];
}

export function editLabel(edit: boolean): string {
  return edit ? "Edits files in its worktree" : "Reads files only";
}

export function webLabel(web: boolean): string {
  return web ? "Searches and fetches the web" : "No web";
}

/** An MCP tool's key in the permission profile, and its name on the card: `server/tool`. */
export function mcpToolKey(serverName: string, toolName: string): string {
  return `${serverName}/${toolName}`;
}

/** Each MCP tool the user set, in key order, such as "MCP tool github/search Allowed". */
export function mcpToolSettingLines(
  settings: PermissionProfile["mcpTools"],
  roleTitles: RoleTitles,
): string[] {
  return Object.entries(settings)
    .toSorted(([first], [second]) => first.localeCompare(second))
    .map(([key, setting]) => `MCP tool ${key} ${hardSwitchValueLabel(setting, roleTitles)}`);
}

/** The profile as lines: what the Agent edits, runs and reaches. */
export function permissionProfileLines(profile: PermissionProfile): string[] {
  return [editLabel(profile.edit), RUN_LABELS[profile.run], webLabel(profile.web)];
}

/** A part of a Role card from one value to another, down to each capability and switch. */
export type RoleCardFieldChange = Extract<RoleChange, { kind: "card-changed" }>["changes"][number];

type ProposedFields = Extract<ProposedChange, { kind: "change" }>["to"];

export function fieldLabel(field: RoleCardField): string {
  return FIELD_LABELS[field];
}

/** One line of the change history, such as "Model Opus 5.5 → Sonnet 5.5". */
export function changeLine(change: RoleCardFieldChange, roleTitles: RoleTitles): string {
  const label = FIELD_LABELS[change.field];
  if (LONG_TEXT_FIELDS.has(change.field)) return `${label} edited`;
  return `${label} ${fieldValueText(change.field, change.from, roleTitles)} → ${fieldValueText(change.field, change.to, roleTitles)}`;
}

/**
 * What a Proposal's change rewrites, as the change history names it: a Proposal holds whole
 * top-level fields, so its capabilities and switches are split into the ones that differ.
 */
export function proposedFieldChanges(
  from: ProposedFields,
  to: ProposedFields,
): RoleCardFieldChange[] {
  const changes: RoleCardFieldChange[] = [];
  for (const key of Object.keys(to) as (keyof ProposedFields)[]) {
    if (key === "capabilities") {
      for (const capability of CAPABILITIES.map(({ key: name }) => name)) {
        const before = from.capabilities?.[capability];
        const after = to.capabilities?.[capability];
        if (before !== undefined && after !== undefined && before !== after) {
          changes.push({ field: `capabilities.${capability}`, from: before, to: after });
        }
      }
    } else if (key === "hardSwitches") {
      for (const hardSwitch of Object.keys(HARD_SWITCH_LABELS) as HardSwitchKey[]) {
        const before = from.hardSwitches?.[hardSwitch];
        const after = to.hardSwitches?.[hardSwitch];
        if (before !== undefined && after !== undefined && !sameValue(before, after)) {
          changes.push({ field: `hardSwitches.${hardSwitch}`, from: before, to: after });
        }
      }
    } else {
      const before = from[key];
      const after = to[key];
      if (before !== undefined && after !== undefined && !sameValue(before, after)) {
        changes.push({ field: key, from: before, to: after });
      }
    }
  }
  return changes;
}

function sameValue(first: RoleCardFieldChange["to"], second: RoleCardFieldChange["to"]): boolean {
  return JSON.stringify(first) === JSON.stringify(second);
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

/** A field's value in words, such as "on", "Opus 5.5" or "Consult Devops". */
export function fieldValueText(
  field: RoleCardField,
  value: RoleCardFieldChange["to"],
  roleTitles: RoleTitles,
): string {
  if (typeof value === "boolean") return value ? "on" : "off";
  if (typeof value === "number") return String(value);
  if (typeof value === "object") {
    return "kind" in value
      ? hardSwitchValueLabel(value, roleTitles)
      : [...permissionProfileLines(value), ...mcpToolSettingLines(value.mcpTools, roleTitles)].join(
          ", ",
        );
  }
  switch (field) {
    case "model":
      return modelLabel(value);
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
