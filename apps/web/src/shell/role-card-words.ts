import {
  ENGINE_TYPE_EFFORTS,
  authorityGroupSchema,
  effortSchema,
  sessionDefaultSchema,
  type Authority,
  type AuthorityArea,
  type AuthorityCap,
  type AuthorityGroup,
  type AuthorityInEffect,
  type AuthorityRow,
  type AuthoritySetting,
  type AuthorityValue,
  type Capabilities,
  type Effort,
  type EngineCascadeLevel,
  type EngineInCascade,
  type EngineCapability,
  type EngineId,
  type EngineKind,
  type HardSwitchKey,
  type HardSwitchValue,
  type PermissionProfile,
  type PersonEngineSettings,
  type ProposedChange,
  type Role,
  type RoleCard,
  type RoleCardField,
  type RoleCardOptions,
  type RoleChange,
  type RunPermission,
  type SessionDefault,
  type TaskLimit,
  type WorkCascadeLevel,
} from "@the-office/contracts";
import type { z } from "zod";
import { EFFORT_LABELS, ENGINE_KIND_LABELS, ENGINE_KINDS, modelLabel } from "./engine-words.ts";
import type { UserNamer } from "./use-user-name.ts";

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
  {
    key: "runEnvironment",
    label: "Run environment",
    icon: "container",
    hint: "Writes a Project's run environment definition through The Office",
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
  languageServers: "It has no LSP tool, so its Agents get no language servers.",
  carrySession: "It can't carry a session over to a Stand-in Engine.",
  startsUsageWindow: "It can't start its 5-hour window by itself.",
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
  changeProjectSettings: "Change Project settings",
};

export const ENFORCEMENT_LABELS = {
  enforced: "Enforced by The Office",
  followed: "Followed by the Agent",
} as const;

/** What a Consult value naming a Role nobody fills does for now. */
export const ASKS_YOU_UNTIL_HIRED = "Asks you until the Role is hired";

export const RUN_LABELS: Readonly<Record<RunPermission, string>> = {
  "read-only-git": "Runs read-only git only",
  "project-commands": "Runs the Project's commands and read-only git",
  anything: "Runs any command; git read-only",
};

/**
 * Each Authority row's name (spec §6 › Tool areas), as `/role-card-options` names them too: the
 * change history names a row by it, with no options at hand.
 */
export const AUTHORITY_ROW_LABELS: Readonly<Record<AuthorityGroup, string>> = {
  taskRecords: "Task records",
  movingWork: "Moving work",
  gatesAndRuns: "Gates and runs",
  continueAtGateOnOwnWork: "Continue at a Gate on own work",
  initiativeRecords: "Initiative records",
  runningAnInitiative: "Running an Initiative",
  ideas: "Ideas",
  captureIdea: "capture_idea",
  changeProjectSettings: "Change Project settings",
  publishingSettings: "Publishing settings",
  projectSettings: "Project settings",
  projectUpkeep: "Project upkeep",
  secretValues: "Secret values",
  changeRoles: "Change Roles",
  memoryAndAvatar: "Memory and Avatar",
  skills: "Skills",
  mcpServers: "MCP servers",
  pipelinesAndStageTemplates: "Pipelines and Stage templates",
  promptTemplates: "Prompt templates",
  officeSettings: "Office settings",
  testInstances: "Test instances",
  projectDevices: "Project devices",
  fireAlarm: "Fire alarm",
  checks: "Checks",
  updatesAndRestarts: "Updates and restarts",
  runInstalls: "Run installs",
  publishOutsideThePipeline: "Publish outside the Pipeline",
  approveHeldCallsAndApplyProposals: "Approve held calls and apply Proposals",
};

export const AUTHORITY_VALUE_LABELS: Readonly<Record<AuthorityValue["kind"], string>> = {
  allowed: "Allowed",
  consult: "Consult",
  "ask-me": "Ask me",
  proposal: "Proposal",
  never: "Never",
};

/** What a capped row takes (spec §6 › The trust anchor). */
export const CAPPED_NOTE = "Proposal, Ask me or Never only";

/** Why a capped row takes only Proposal, Ask me or Never: its reason's name and what it says. */
export const CAP_REASONS: Readonly<Record<AuthorityCap, { name: string; words: string }>> = {
  "trust-anchor": {
    name: "the trust anchor",
    words:
      "The trust anchor: the Office tools that change the rules binding Agents. A colleague's Allow once could let one Agent loosen the rules binding another, so they never take Allowed or Consult.",
  },
  "users-alone": {
    name: "The user's alone",
    words:
      "The user's alone: how a Project publishes stays yours, so an Agent only proposes it or asks you.",
  },
};

/** A followed row's badge, and what enforces it all the same, such as `run_environment_check`. */
export function followedWords({ enforcedOn }: Pick<AuthorityRow, "enforcedOn">): string {
  return enforcedOn === null
    ? ENFORCEMENT_LABELS.followed
    : `${ENFORCEMENT_LABELS.followed}, enforced on ${enforcedOn}`;
}

/** What a row at its preset's default reads as in the change history. */
export const PRESET_DEFAULT = "Preset default";

/** "Preset default (Ask me)": a row standing at its preset's default. */
export function presetDefaultWords(valueWords: string): string {
  return `${PRESET_DEFAULT} (${valueWords})`;
}

/** A value in words: "Allowed", "Consult Devops", "Ask me", "Proposal" or "Never". */
export function authorityValueLabel(value: AuthorityValue, roleTitles: RoleTitles): string {
  return value.kind === "consult"
    ? `Consult ${roleTitles.get(value.role) ?? value.role}`
    : AUTHORITY_VALUE_LABELS[value.kind];
}

/** A setting in words; a pair whose sides differ as "Own: Allowed · Others': Ask me". */
export function authoritySettingLabel(setting: AuthoritySetting, roleTitles: RoleTitles): string {
  if (setting.kind !== "own-and-others") return authorityValueLabel(setting, roleTitles);
  if (sameAuthorityValue(setting.own, setting.others)) {
    return authorityValueLabel(setting.own, roleTitles);
  }
  return `Own: ${authorityValueLabel(setting.own, roleTitles)} · Others': ${authorityValueLabel(setting.others, roleTitles)}`;
}

export function sameAuthorityValue(first: AuthorityValue, second: AuthorityValue): boolean {
  if (first.kind === "consult" && second.kind === "consult") return first.role === second.role;
  return first.kind === second.kind;
}

/** A setting's own and others' values; one value is both. */
export function ownAndOthersOf(
  setting: AuthoritySetting,
): readonly [own: AuthorityValue, others: AuthorityValue] {
  return setting.kind === "own-and-others" ? [setting.own, setting.others] : [setting, setting];
}

/** A pair with two equal sides is the same setting as its one value. */
export function sameAuthoritySetting(first: AuthoritySetting, second: AuthoritySetting): boolean {
  const [firstOwn, firstOthers] = ownAndOthersOf(first);
  const [secondOwn, secondOthers] = ownAndOthersOf(second);
  return sameAuthorityValue(firstOwn, secondOwn) && sameAuthorityValue(firstOthers, secondOthers);
}

/** The setting of an own and an others' value: one value when they are the same. */
export function settingOf(own: AuthorityValue, others: AuthorityValue): AuthoritySetting {
  return sameAuthorityValue(own, others) ? own : { kind: "own-and-others", own, others };
}

/**
 * The value an area's row shows: the one most of its groups share, a tie going to the first group's
 * (People › Role card tab); undefined for an area with no rows.
 */
export function areaSetting(
  area: AuthorityArea,
  inEffect: AuthorityInEffect,
): AuthoritySetting | undefined {
  const counts: { setting: AuthoritySetting; count: number }[] = [];
  for (const { group } of area.rows) {
    const setting = inEffect[group];
    const counted = counts.find((each) => sameAuthoritySetting(each.setting, setting));
    if (counted) counted.count += 1;
    else counts.push({ setting, count: 1 });
  }
  let most: (typeof counts)[number] | undefined;
  for (const each of counts) if (!most || each.count > most.count) most = each;
  return most?.setting;
}

/**
 * The Authority in a few lines, as a chat's Proposal card has room for: each tool area with the value
 * most of its groups share, then each row in no area, such as "Work: Never" and "Run installs: Ask me".
 */
export function authoritySummaryLines(
  areas: readonly AuthorityArea[],
  inEffect: AuthorityInEffect,
  roleTitles: RoleTitles,
): string[] {
  return areas.flatMap((area) => {
    if (area.label === null) {
      return area.rows.map(
        ({ group, label }) => `${label}: ${authoritySettingLabel(inEffect[group], roleTitles)}`,
      );
    }
    const setting = areaSetting(area, inEffect);
    return setting ? [`${area.label}: ${authoritySettingLabel(setting, roleTitles)}`] : [];
  });
}

/** Every row's setting: the card's set rows over the defaults. */
export function authorityInEffect(
  defaults: AuthorityInEffect,
  authority: Authority,
): AuthorityInEffect {
  return { ...defaults, ...authority };
}

/** A value as one choice of a select: "consult:devops" for Consult Devops. */
export function authorityChoiceOf(value: AuthorityValue): string {
  return value.kind === "consult" ? `${CONSULT_CHOICE}${value.role}` : value.kind;
}

export function authorityValueOf(choice: string): AuthorityValue {
  if (choice.startsWith(CONSULT_CHOICE)) {
    return { kind: "consult", role: choice.slice(CONSULT_CHOICE.length) };
  }
  const kind = (["allowed", "ask-me", "proposal", "never"] as const).find(
    (known) => known === choice,
  );
  if (kind === undefined) throw new Error(`No Authority value is chosen as ${choice}.`);
  return { kind };
}

/**
 * A row's choices, in its values' order, Consult as one choice per Role of `consultable`; a Consult
 * of a Role not among them (one no longer known) stays offered while it is the row's value.
 */
export function authorityChoices(
  values: AuthorityRow["values"],
  consultable: readonly { readonly key: string; readonly title: string }[],
  current: AuthorityValue,
): { value: string; label: string }[] {
  return values.flatMap((kind) => {
    if (kind !== "consult") return [{ value: kind, label: AUTHORITY_VALUE_LABELS[kind] }];
    const roles = consultable.map(({ key, title }) => ({ key, title }));
    if (current.kind === "consult" && !roles.some(({ key }) => key === current.role)) {
      roles.push({ key: current.role, title: current.role });
    }
    return roles.map(({ key, title }) => ({
      value: authorityChoiceOf({ kind: "consult", role: key }),
      label: `Consult ${title}`,
    }));
  });
}

const FIELD_LABELS: Readonly<Record<RoleCardField, string>> = {
  name: "Name",
  title: "Title",
  responsibilities: "Responsibilities",
  instructions: "Instructions",
  engine: "Engine",
  model: "Model",
  roleOverride: "Engine and model",
  effort: "Effort",
  engineSettings: "Model and effort",
  engineSettingsMovedOver: "Engine settings moved over",
  taskLimit: "Task limit",
  sessionDefault: "Session default",
  "capabilities.sharedMemory": "Shared memory",
  "capabilities.chat": "Chat",
  "capabilities.consultant": "Consultant",
  "capabilities.runEnvironment": "Run environment",
  permissionProfile: "Permission profile",
  "hardSwitches.runInstalls": HARD_SWITCH_LABELS.runInstalls,
  "hardSwitches.publishOutsideThePipeline": HARD_SWITCH_LABELS.publishOutsideThePipeline,
  "hardSwitches.changeRoles": HARD_SWITCH_LABELS.changeRoles,
  "hardSwitches.changeProjectSettings": HARD_SWITCH_LABELS.changeProjectSettings,
  authorityMovedOver: "Authority from the Hard switches and duties",
  ...(Object.fromEntries(
    authorityGroupSchema.options.map((group) => [
      `authority.${group}`,
      `Authority › ${AUTHORITY_ROW_LABELS[group]}`,
    ]),
  ) as Record<`authority.${AuthorityGroup}`, string>),
};

/** Too long to show both versions in a line of the change history. */
const LONG_TEXT_FIELDS: ReadonlySet<RoleCardField> = new Set(["responsibilities", "instructions"]);

/** Each Role's title by its key, as Consult values name them. */
export type RoleTitles = ReadonlyMap<string, string>;

export function roleTitlesOf(options: RoleCardOptions): RoleTitles {
  return new Map(options.knownRoles.map(({ key, title }) => [key, title]));
}

/** What a field's value may name by key or id, as the change history and Proposals show it. */
export interface FieldValueNames {
  readonly roleTitles: RoleTitles;
  readonly engineName: (engineId: EngineId) => string;
}

/** What an unset model or effort reads as: the engine's own. */
export const ENGINES_DEFAULT = "Engine's default";

/** When the person sets no model or effort on any engine type. */
export const EACH_ENGINES_DEFAULT = "Each engine's default model and effort";

/** "effort high"; null: the engine's default. */
export function effortText(effort: Effort | null): string {
  return effort === null ? ENGINES_DEFAULT : `effort ${EFFORT_LABELS[effort].toLowerCase()}`;
}

/** Whether the engine type takes an effort at all. */
export function takesEffort(type: EngineKind): boolean {
  return ENGINE_TYPE_EFFORTS[type].length > 0;
}

/**
 * The model and effort the person works with on each engine type they set, one line each in the
 * spec's order of types, "Claude Code: Sonnet 5.5 · effort max", an unset part "Engine's default";
 * a type taking no effort names its model only.
 */
export function engineSettingsLines(engineSettings: PersonEngineSettings): string[] {
  return ENGINE_KINDS.flatMap((type) => {
    const setting = engineSettings[type];
    if (!setting || (setting.model === null && setting.effort === null)) return [];
    const model = setting.model === null ? ENGINES_DEFAULT : modelLabel(setting.model);
    const parts = takesEffort(type) ? [model, effortText(setting.effort)] : [model];
    return [`${ENGINE_KIND_LABELS[type]}: ${parts.join(" · ")}`];
  });
}

/** The card's "Works with" lines, or "Each engine's default model and effort" when it sets none. */
export function worksWithLines({ engineSettings }: Pick<RoleCard, "engineSettings">): string[] {
  const lines = engineSettingsLines(engineSettings);
  return lines.length > 0 ? lines : [EACH_ENGINES_DEFAULT];
}

/** Where the engine a Role runs on comes from, in the glossary's terms. */
export const ENGINE_CASCADE_LEVEL_WORDS: Readonly<Record<EngineCascadeLevel, string>> = {
  office: "the Office default",
  project: "the Project default",
  initiative: "the Initiative's engine override",
  task: "the Task's engine override",
};

/** Where a model or effort comes from, "from Pam's Role card", for the person named. */
export function workCascadeLevelWords(level: WorkCascadeLevel, personName: string): string {
  switch (level) {
    case "engine":
      return "the engine's default";
    case "person":
      return `from ${personName}'s Role card`;
    case "projectPerson":
      return `from the Project's setting for ${personName}`;
    case "projectForce":
      return "forced by the Project";
    case "stage":
      return "from the Stage";
  }
}

/** "Sonnet 5.5 · effort high": the model and effort a person works with where they run. */
export function modelAndEffortText({
  model,
  effort,
}: Pick<EngineInCascade, "model" | "effort">): string {
  return effort === null ? modelLabel(model) : `${modelLabel(model)} · ${effortText(effort)}`;
}

/** "Sonnet 5.5 · effort high on Work account"; an effort left to the runtime is left out. */
export function engineInCascadeText(applies: EngineInCascade): string {
  return `${modelAndEffortText(applies)} on ${applies.engineName}`;
}

/**
 * Where the model and effort come from: one phrase when both come from one level ("from Pam's Role
 * card"), else each its own ("model: from Pam's Role card; effort: forced by the Project").
 */
export function workSourceText(
  {
    modelLevel,
    effortLevel,
    effort,
  }: Pick<EngineInCascade, "modelLevel" | "effortLevel" | "effort">,
  personName: string,
): string {
  if (effort === null || modelLevel === effortLevel) {
    return workCascadeLevelWords(modelLevel, personName);
  }
  return `model: ${workCascadeLevelWords(modelLevel, personName)}; effort: ${workCascadeLevelWords(effortLevel, personName)}`;
}

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
export function changeLine(change: RoleCardFieldChange, names: FieldValueNames): string {
  const label = FIELD_LABELS[change.field];
  if (LONG_TEXT_FIELDS.has(change.field)) return `${label} edited`;
  if (change.field === "engineSettingsMovedOver") return movedOverLine(change, names);
  // Made from the Hard switches and duties: the card's rows show what it came to.
  if (change.field === "authorityMovedOver") return label;
  return `${label} ${fieldValueText(change.field, change.from, names)} → ${fieldValueText(change.field, change.to, names)}`;
}

/**
 * The line of a card moved over to engine settings: a Role override's model kept on the engine type
 * it moved to, naming the account its sessions no longer run on, or one on an engine no longer
 * listed dropped (spec §5.4.5, "Moving the earlier engine settings over").
 */
function movedOverLine({ from, to }: RoleCardFieldChange, names: FieldValueNames): string {
  const label = FIELD_LABELS.engineSettingsMovedOver;
  if (from === null || typeof from !== "object" || !("engineId" in from)) return label;
  const movedTo = ENGINE_KINDS.find((type) => type === to);
  return movedTo
    ? `${label}, ${modelLabel(from.model)} kept on ${ENGINE_KIND_LABELS[movedTo]}; sessions no longer run on ${names.engineName(from.engineId)}`
    : `${label}, the Role override ${fieldValueText("roleOverride", from, names)} dropped`;
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
    } else if (key === "authority") {
      // A row left out stands at the preset's default, null in the change history.
      const before = from.authority ?? {};
      const after = to.authority ?? {};
      for (const group of authorityGroupSchema.options) {
        const was = before[group] ?? null;
        const becomes = after[group] ?? null;
        if (to.authority !== undefined && !sameValue(was, becomes)) {
          changes.push({ field: `authority.${group}`, from: was, to: becomes });
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

/**
 * Who made a Role change: who drafted the Proposal a user applied, by name, and who applied it; the
 * person who changed their own card, with no user saving it ("by Grace"); or the user who made the
 * change themselves ("by you", "by Ann Lee"); undefined when nobody is known. A Role nobody fills any
 * more by its key.
 */
export function roleChangeByLine(
  change: RoleChange,
  roles: readonly Pick<Role, "key" | "card">[] | undefined,
  nameOfUser: UserNamer,
): string | undefined {
  const user = change.kind === "skills-changed" ? change.changedBy : change.savedBy;
  const proposedBy = change.kind === "skills-changed" ? null : change.proposedBy;
  if (proposedBy !== null) {
    const name = roles?.find(({ key }) => key === proposedBy)?.card.name ?? proposedBy;
    return user === null
      ? `by ${name}`
      : `proposed by ${name}, applied by ${nameOfUser(user, "you")}`;
  }
  return user === null ? undefined : `by ${nameOfUser(user, "you")}`;
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

/** A field's value in words, such as "on", "Opus 5.5", "Work account" or "Consult Devops". */
export function fieldValueText(
  field: RoleCardField,
  value: RoleCardFieldChange["to"],
  { roleTitles, engineName }: FieldValueNames,
): string {
  if (typeof value === "boolean") return value ? "on" : "off";
  if (typeof value === "number") return String(value);
  if (field === "engineSettings") {
    const settings = value !== null && typeof value === "object" ? value : {};
    const lines = engineSettingsLines(settings as PersonEngineSettings);
    return lines.length > 0 ? lines.join("; ") : EACH_ENGINES_DEFAULT;
  }
  if (value === null) return field.startsWith("authority.") ? PRESET_DEFAULT : "Office default";
  if (typeof value === "object") {
    if ("engineId" in value) return `${engineName(value.engineId)} · ${modelLabel(value.model)}`;
    if ("kind" in value) return authoritySettingLabel(value, roleTitles);
    if ("mcpTools" in value) {
      return [
        ...permissionProfileLines(value),
        ...mcpToolSettingLines(value.mcpTools, roleTitles),
      ].join(", ");
    }
    return engineSettingsLines(value as PersonEngineSettings).join("; ") || EACH_ENGINES_DEFAULT;
  }
  switch (field) {
    case "engine":
      return engineName(value);
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
