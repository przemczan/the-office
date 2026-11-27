import {
  ALLOWED,
  ASK_ME,
  consult,
  HARD_SWITCH_KEYS,
  hardSwitchInEffect,
  NEVER,
  type HardSwitches,
  type HardSwitchKey,
  type HardSwitchValue,
} from "./hard-switches.js";
import {
  CARETAKER,
  CTO,
  DEVELOPER,
  DEVOPS,
  OFFICE_MANAGER,
  PLANNER,
  REVIEWER,
} from "./known-roles.js";

/** Spec §6 › Authority's groups and single tools, in the Role card's order. */
export const AUTHORITY_GROUPS = [
  "taskRecords",
  "movingWork",
  "gatesAndRuns",
  "continueAtGateOnOwnWork",
  "initiativeRecords",
  "runningAnInitiative",
  "ideas",
  "captureIdea",
  "changeProjectSettings",
  "publishingSettings",
  "projectSettings",
  "projectUpkeep",
  "secretValues",
  "proposeProjectCommands",
  "proposeTestTargets",
  "proposeActions",
  "changeRoles",
  "memoryAndAvatar",
  "skills",
  "mcpServers",
  "pipelinesAndStageTemplates",
  "promptTemplates",
  "officeSettings",
  "postLinkCard",
  "showOfficeStatus",
  "testInstances",
  "projectDevices",
  "fireAlarm",
  "checks",
  "updatesAndRestarts",
  "runInstalls",
  "publishOutsideThePipeline",
  "approveHeldCallsAndApplyProposals",
] as const;
export type AuthorityGroup = (typeof AUTHORITY_GROUPS)[number];

/** Whether `key` is a group of the catalog, as the Office tools of other modules name theirs. */
export function isAuthorityGroup(key: string): key is AuthorityGroup {
  return (AUTHORITY_GROUPS as readonly string[]).includes(key);
}

/** A Hard switch's values, and Proposal: the person drafts it and the user applies it. */
export type AuthorityValue = HardSwitchValue | { readonly kind: "proposal" };
export type AuthorityValueKind = AuthorityValue["kind"];

/** A record row's value on the person's own records and on others'. */
export interface OwnAndOthers {
  readonly kind: "own-and-others";
  readonly own: AuthorityValue;
  readonly others: AuthorityValue;
}

export type AuthoritySetting = AuthorityValue | OwnAndOthers;

/** The rows a card sets; a row left out is at the preset's default. */
export type Authority = Partial<Readonly<Record<AuthorityGroup, AuthoritySetting>>>;

/** Every row's setting, the preset's defaults filled in. */
export type AuthorityInEffect = Readonly<Record<AuthorityGroup, AuthoritySetting>>;

export const PROPOSAL: AuthorityValue = { kind: "proposal" };

/**
 * Why a row takes only Proposal, Ask me or Never: the trust anchor, or The user's alone for
 * Publishing settings (spec §6).
 */
export type AuthorityCap = "trust-anchor" | "users-alone";

export interface AuthorityRow {
  readonly group: AuthorityGroup;
  readonly label: string;
  readonly cap: AuthorityCap | null;
  /** Work, Initiatives and Ideas records: it may take an own and an others' value. */
  readonly ownAndOthers: boolean;
  /** The Agent follows it in plain words; no Office tool can draft it, so it takes no Proposal. */
  readonly followed: boolean;
  /** The Office tool that enforces a followed group all the same. */
  readonly enforcedOn: string | null;
  /**
   * The only values a single tool's row takes when it isn't the whole set: Allowed or Never for a
   * tool that runs at once, Proposal or Never for one that drafts; null for every other row.
   */
  readonly onlyValues: readonly AuthorityValueKind[] | null;
}

export interface AuthorityArea {
  /** Null for the followed groups and the row in no area, shown last. */
  readonly label: string | null;
  readonly rows: readonly AuthorityRow[];
}

function row(
  group: AuthorityGroup,
  label: string,
  {
    cap = null,
    ownAndOthers = false,
    onlyValues = null,
  }: {
    cap?: AuthorityCap | null;
    ownAndOthers?: boolean;
    onlyValues?: readonly AuthorityValueKind[] | null;
  } = {},
): AuthorityRow {
  return { group, label, cap, ownAndOthers, followed: false, enforcedOn: null, onlyValues };
}

/** A single tool that runs at once or is not offered. */
const ALLOWED_OR_NEVER: readonly AuthorityValueKind[] = ["allowed", "never"];

/** A single tool that drafts a Proposal or is not offered. */
const PROPOSAL_OR_NEVER: readonly AuthorityValueKind[] = ["proposal", "never"];

/** The Role card's Authority section (spec §6 › Tool areas), in its order. */
export const AUTHORITY_AREAS: readonly AuthorityArea[] = [
  {
    label: "Work",
    rows: [
      row("taskRecords", "Task records", { ownAndOthers: true }),
      row("movingWork", "Moving work"),
      row("gatesAndRuns", "Gates and runs"),
      row("continueAtGateOnOwnWork", "Continue at a Gate on own work", { cap: "trust-anchor" }),
    ],
  },
  {
    label: "Initiatives",
    rows: [
      row("initiativeRecords", "Initiative records", { ownAndOthers: true }),
      row("runningAnInitiative", "Running an Initiative"),
    ],
  },
  {
    label: "Ideas",
    rows: [row("ideas", "Ideas", { ownAndOthers: true }), row("captureIdea", "capture_idea")],
  },
  {
    label: "Projects and settings",
    rows: [
      row("changeProjectSettings", "Change Project settings"),
      row("publishingSettings", "Publishing settings", { cap: "users-alone" }),
      row("projectSettings", "Project settings"),
      row("projectUpkeep", "Project upkeep"),
      row("secretValues", "Secret values", { cap: "trust-anchor" }),
      row("proposeProjectCommands", "propose_project_commands", {
        onlyValues: PROPOSAL_OR_NEVER,
      }),
      row("proposeTestTargets", "propose_test_targets", { onlyValues: PROPOSAL_OR_NEVER }),
      row("proposeActions", "propose_actions", { onlyValues: PROPOSAL_OR_NEVER }),
    ],
  },
  {
    label: "People and Roles",
    rows: [
      row("changeRoles", "Change Roles", { cap: "trust-anchor" }),
      row("memoryAndAvatar", "Memory and Avatar"),
    ],
  },
  {
    label: "Library",
    rows: [
      row("skills", "Skills"),
      row("mcpServers", "MCP servers"),
      row("pipelinesAndStageTemplates", "Pipelines and Stage templates"),
      row("promptTemplates", "Prompt templates"),
    ],
  },
  {
    label: "Office settings",
    rows: [
      row("officeSettings", "Office settings"),
      row("postLinkCard", "post_link_card", { onlyValues: ALLOWED_OR_NEVER }),
      row("showOfficeStatus", "show_office_status", { onlyValues: ALLOWED_OR_NEVER }),
    ],
  },
  {
    label: "Test instances and devices",
    rows: [row("testInstances", "Test instances"), row("projectDevices", "Project devices")],
  },
  {
    label: "Operations",
    rows: [
      row("fireAlarm", "Fire alarm"),
      row("checks", "Checks"),
      row("updatesAndRestarts", "Updates and restarts"),
    ],
  },
  {
    label: null,
    rows: [
      {
        ...row("runInstalls", "Run installs"),
        followed: true,
        enforcedOn: "run_environment_check",
      },
      { ...row("publishOutsideThePipeline", "Publish outside the Pipeline"), followed: true },
      row("approveHeldCallsAndApplyProposals", "Approve held calls and apply Proposals", {
        cap: "trust-anchor",
      }),
    ],
  },
];

const ROWS: ReadonlyMap<AuthorityGroup, AuthorityRow> = new Map(
  AUTHORITY_AREAS.flatMap((area) => area.rows.map((each) => [each.group, each] as const)),
);

export function authorityRow(group: AuthorityGroup): AuthorityRow {
  const found = ROWS.get(group);
  if (!found) throw new Error(`No Authority row for ${group}.`);
  return found;
}

/**
 * What a row's value is held to: on a capped row (the trust anchor, Users alone) Allowed and Consult
 * read as Ask me, so a card edited by hand past the Role card's own checks still holds the call.
 */
export function heldToCap(group: AuthorityGroup, value: AuthorityValue): AuthorityValue {
  if (authorityRow(group).cap === null) return value;
  return value.kind === "allowed" || value.kind === "consult" ? ASK_ME : value;
}

const ALL_VALUE_KINDS: readonly AuthorityValueKind[] = [
  "allowed",
  "consult",
  "ask-me",
  "proposal",
  "never",
];

/** The values a row takes, in the select's order. */
export function valuesTakenBy(group: AuthorityGroup): readonly AuthorityValueKind[] {
  const { cap, followed, onlyValues } = authorityRow(group);
  if (onlyValues) return onlyValues;
  if (cap) return ["proposal", "ask-me", "never"];
  if (followed) return ALL_VALUE_KINDS.filter((kind) => kind !== "proposal");
  return ALL_VALUE_KINDS;
}

const own = (ownValue: AuthorityValue, others: AuthorityValue): OwnAndOthers => ({
  kind: "own-and-others",
  own: ownValue,
  others,
});

/** The defaults of a Role hired from scratch: Ask me, the capped rows Never (spec §6 › Defaults). */
export const FROM_SCRATCH_AUTHORITY: AuthorityInEffect = {
  ...(Object.fromEntries(
    AUTHORITY_GROUPS.map((group) => [group, authorityRow(group).cap ? NEVER : ASK_ME]),
  ) as Record<AuthorityGroup, AuthoritySetting>),
  skills: PROPOSAL,
  captureIdea: ALLOWED,
  // The single tools that take no Ask me are Never until the card sets them.
  proposeProjectCommands: NEVER,
  proposeTestTargets: NEVER,
  proposeActions: NEVER,
  postLinkCard: NEVER,
  showOfficeStatus: NEVER,
};

/** Every row Never but what `set` gives, as each preset reads in spec §6 › Authority by role. */
function neverBut(set: Authority): AuthorityInEffect {
  return {
    ...(Object.fromEntries(AUTHORITY_GROUPS.map((group) => [group, NEVER])) as Record<
      AuthorityGroup,
      AuthoritySetting
    >),
    ideas: own(ALLOWED, ASK_ME),
    captureIdea: ALLOWED,
    skills: PROPOSAL,
    ...set,
  };
}

/** Each preset's defaults, by its Role's key (spec §6 › Defaults › Authority by role). */
const PRESET_AUTHORITY: Readonly<Record<string, AuthorityInEffect>> = {
  [PLANNER]: neverBut({
    taskRecords: own(ALLOWED, ASK_ME),
    movingWork: ASK_ME,
    memoryAndAvatar: ASK_ME,
    runInstalls: consult(DEVOPS),
  }),
  [DEVELOPER]: neverBut({
    taskRecords: own(ALLOWED, ASK_ME),
    changeProjectSettings: consult(DEVOPS),
    testInstances: ALLOWED,
    projectDevices: ASK_ME,
    runInstalls: consult(DEVOPS),
    publishOutsideThePipeline: consult(CTO),
  }),
  [REVIEWER]: neverBut({
    taskRecords: own(ALLOWED, NEVER),
    ideas: own(ALLOWED, NEVER),
    testInstances: ALLOWED,
    runInstalls: consult(DEVOPS),
  }),
  [CTO]: neverBut({
    taskRecords: own(ALLOWED, ASK_ME),
    movingWork: ASK_ME,
    gatesAndRuns: ASK_ME,
    continueAtGateOnOwnWork: ASK_ME,
    initiativeRecords: own(ALLOWED, ASK_ME),
    runningAnInitiative: ASK_ME,
    changeProjectSettings: consult(DEVOPS),
    memoryAndAvatar: ASK_ME,
    testInstances: ALLOWED,
    fireAlarm: ALLOWED,
    checks: ALLOWED,
    runInstalls: consult(DEVOPS),
    publishOutsideThePipeline: ASK_ME,
  }),
  [DEVOPS]: neverBut({
    taskRecords: own(ALLOWED, ASK_ME),
    changeProjectSettings: ALLOWED,
    publishingSettings: PROPOSAL,
    projectSettings: PROPOSAL,
    projectUpkeep: ALLOWED,
    proposeProjectCommands: PROPOSAL,
    proposeTestTargets: PROPOSAL,
    proposeActions: PROPOSAL,
    memoryAndAvatar: ASK_ME,
    mcpServers: PROPOSAL,
    pipelinesAndStageTemplates: PROPOSAL,
    testInstances: ALLOWED,
    projectDevices: ASK_ME,
    fireAlarm: ALLOWED,
    checks: ALLOWED,
    updatesAndRestarts: ASK_ME,
    runInstalls: ALLOWED,
    publishOutsideThePipeline: consult(CTO),
  }),
  [OFFICE_MANAGER]: neverBut({
    movingWork: ASK_ME,
    gatesAndRuns: ASK_ME,
    initiativeRecords: own(ALLOWED, ASK_ME),
    runningAnInitiative: ASK_ME,
    changeRoles: PROPOSAL,
    memoryAndAvatar: ASK_ME,
    promptTemplates: PROPOSAL,
    officeSettings: PROPOSAL,
    postLinkCard: ALLOWED,
    showOfficeStatus: ALLOWED,
    fireAlarm: ALLOWED,
    checks: ALLOWED,
    updatesAndRestarts: ASK_ME,
  }),
};

/**
 * The Caretaker's fixed Authority (spec §2.2 › Caretaker): its reach before Authority, each row
 * narrowed to what it drafts, every other row Never.
 */
export const CARETAKER_AUTHORITY: AuthorityInEffect = neverBut({
  taskRecords: own(ALLOWED, ASK_ME),
  changeRoles: PROPOSAL,
  officeSettings: PROPOSAL,
  pipelinesAndStageTemplates: PROPOSAL,
  projectSettings: PROPOSAL,
  promptTemplates: PROPOSAL,
  runInstalls: ALLOWED,
  publishOutsideThePipeline: ALLOWED,
});

/** Where the Role's rows stand at its preset's default; a Role no preset has is from scratch's. */
export function presetAuthority(roleKey: string): AuthorityInEffect {
  if (roleKey === CARETAKER) return CARETAKER_AUTHORITY;
  return PRESET_AUTHORITY[roleKey] ?? FROM_SCRATCH_AUTHORITY;
}

/** What the card's Authority amounts to: its set rows over its preset's defaults. */
export function authorityInEffect(roleKey: string, authority: Authority): AuthorityInEffect {
  if (roleKey === CARETAKER) return CARETAKER_AUTHORITY;
  return { ...presetAuthority(roleKey), ...authority };
}

/** A setting's values: one, or the own and others' values of a pair. */
export function valuesOf(setting: AuthoritySetting): readonly AuthorityValue[] {
  return setting.kind === "own-and-others" ? [setting.own, setting.others] : [setting];
}

export function sameAuthorityValue(first: AuthorityValue, second: AuthorityValue): boolean {
  if (first.kind === "consult" && second.kind === "consult") return first.role === second.role;
  return first.kind === second.kind;
}

/** A pair with two equal sides is the same setting as its one value. */
export function sameAuthoritySetting(first: AuthoritySetting, second: AuthoritySetting): boolean {
  const [firstOwn, firstOthers] = ownAndOthersOf(first);
  const [secondOwn, secondOthers] = ownAndOthersOf(second);
  return sameAuthorityValue(firstOwn, secondOwn) && sameAuthorityValue(firstOthers, secondOthers);
}

function ownAndOthersOf(setting: AuthoritySetting): readonly [AuthorityValue, AuthorityValue] {
  return setting.kind === "own-and-others" ? [setting.own, setting.others] : [setting, setting];
}

/** The setting as it is kept: a pair with two equal sides as its one value. */
export function keptSetting(setting: AuthoritySetting): AuthoritySetting {
  return setting.kind === "own-and-others" && sameAuthorityValue(setting.own, setting.others)
    ? setting.own
    : setting;
}

/** The card's Authority as it is kept: each pair of equal sides as one value. */
export function keptAuthority(authority: Authority): Authority {
  return Object.fromEntries(
    Object.entries(authority).map(([group, setting]) => [group, keptSetting(setting)]),
  );
}

/** The set rows without those equal to the preset's default, which stand at it instead. */
export function withoutPresetDefaults(roleKey: string, authority: Authority): Authority {
  const defaults = presetAuthority(roleKey);
  return Object.fromEntries(
    Object.entries(authority)
      .filter(
        ([group, setting]) => !sameAuthoritySetting(setting, defaults[group as AuthorityGroup]),
      )
      .map(([group, setting]) => [group, keptSetting(setting)]),
  );
}

/**
 * Why a Role's Authority can't be saved, in the UI's words; empty when it can. A capped row takes
 * only Proposal, Ask me or Never; a followed row takes no Proposal; only the record rows take own
 * and others' values; a Consult names a Role of `consultable` (`consultableRoleKeys`), never the
 * Role itself; and the Caretaker's Authority is fixed.
 */
export function authorityProblems(
  roleKey: string,
  authority: Authority,
  consultable: ReadonlySet<string>,
): string[] {
  if (roleKey === CARETAKER) {
    return Object.keys(authority).length === 0 ? [] : ["The Caretaker's Authority is fixed."];
  }
  return Object.entries(authority).flatMap(([key, setting]) => {
    const group = key as AuthorityGroup;
    const found = ROWS.get(group);
    if (!found) return [`The Authority has no row "${key}".`];
    const { label, cap, ownAndOthers } = found;
    const problems: string[] = [];
    if (setting.kind === "own-and-others" && !ownAndOthers) {
      problems.push(`${label} takes one value, the same on everyone's work.`);
    }
    const taken = valuesTakenBy(group);
    for (const value of valuesOf(setting)) {
      if (!taken.includes(value.kind)) {
        problems.push(
          cap
            ? `${label} takes Proposal, Ask me or Never only.`
            : found.onlyValues
              ? `${label} takes ${found.onlyValues.map(valueWords).join(" or ")} only.`
              : `${label} can't be Proposal: no Office tool drafts it.`,
        );
      } else if (value.kind === "consult" && !consultable.has(value.role)) {
        problems.push(`${label} consults a Role The Office doesn't know.`);
      } else if (value.kind === "consult" && value.role === roleKey) {
        problems.push(`${label} can't consult the Role itself.`);
      }
    }
    return [...new Set(problems)];
  });
}

function valueWords(kind: AuthorityValueKind): string {
  return kind === "never" ? "Never" : kind === "allowed" ? "Allowed" : "Proposal";
}

/** The rows whose Consult value names a Role nobody fills, so they ask the user until it is. */
export function rowsAskingYouUntilHired(
  authority: AuthorityInEffect,
  hiredRoles: ReadonlySet<string>,
): AuthorityGroup[] {
  return AUTHORITY_GROUPS.filter((group) =>
    valuesOf(authority[group]).some(
      (value) => value.kind === "consult" && hardSwitchInEffect(value, hiredRoles) !== value,
    ),
  );
}

/**
 * The Hard switches as the release before Authority reads them, and as today's held calls do: each
 * its named group's value, Proposal read as Never, since the direct tool isn't offered then and the
 * person's drafting tools carry it.
 */
export function hardSwitchesOf(roleKey: string, authority: Authority): HardSwitches {
  const inEffect = authorityInEffect(roleKey, authority);
  return Object.fromEntries(
    HARD_SWITCH_KEYS.map((key) => [key, asHardSwitch(inEffect[key])]),
  ) as Record<HardSwitchKey, HardSwitchValue>;
}

function asHardSwitch(setting: AuthoritySetting): HardSwitchValue {
  const value = setting.kind === "own-and-others" ? setting.others : setting;
  return value.kind === "proposal" ? NEVER : value;
}

/**
 * The Authority of a card that carries Hard switches the Authority `base` doesn't say (an earlier
 * release's save, an open Proposal's draft): each switch that differs from `base`'s view of it is
 * set, Change Roles held to the trust anchor's cap, Allowed and Consult reading as Ask me. A missing
 * switch, as Change Project settings on a card saved before it existed, reads as Ask me.
 */
export function authorityWithHardSwitches(
  roleKey: string,
  base: Authority,
  switches: Partial<HardSwitches>,
): Authority {
  if (roleKey === CARETAKER) return {};
  const view = hardSwitchesOf(roleKey, base);
  const overlaid: Partial<Record<AuthorityGroup, AuthoritySetting>> = { ...base };
  for (const key of HARD_SWITCH_KEYS) {
    const value = switches[key] ?? ASK_ME;
    if (sameAuthorityValue(value, view[key])) continue;
    overlaid[key] = key === "changeRoles" && value.kind !== "never" ? ASK_ME : value;
  }
  return overlaid;
}
