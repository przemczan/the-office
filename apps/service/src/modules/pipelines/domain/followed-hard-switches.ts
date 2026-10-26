/**
 * A followed Hard switch's value on the Role card (spec §6), with whom Consult names as the Agent
 * reads it, such as Devops.
 */
export type FollowedHardSwitchValue =
  | { readonly kind: "allowed" }
  | { readonly kind: "consult"; readonly person: string }
  | { readonly kind: "ask-me" }
  | { readonly kind: "never" };

/**
 * The Hard switches the Agent follows, told in plain words by its brief, since The Office stays
 * agnostic of each Project's stack; change Roles and git are enforced in code instead (spec §6).
 */
export interface FollowedHardSwitches {
  readonly runInstalls: FollowedHardSwitchValue;
  readonly publishOutsideThePipeline: FollowedHardSwitchValue;
}

type FollowedHardSwitchKey = keyof FollowedHardSwitches;

/** Each switch's call, as the Agent would make it: "Before you …", "You may …". */
const CALLS: Readonly<Record<FollowedHardSwitchKey, string>> = {
  runInstalls: "install anything that changes the machine outside the worktree",
  publishOutsideThePipeline:
    "publish anything outside the Pipeline, such as pushing a branch, opening a pull request, releasing or deploying",
};

/** What each switch leaves out, so the Agent doesn't ask for its ordinary work. */
const NOT_THE_CALL: Readonly<Record<FollowedHardSwitchKey, string>> = {
  runInstalls:
    "Adding or updating the Project's own dependencies is a code change, not an install.",
  publishOutsideThePipeline: "The Office publishes the Task's work itself once the Pipeline ends.",
};

const ORDER: readonly FollowedHardSwitchKey[] = ["runInstalls", "publishOutsideThePipeline"];

/**
 * The brief's Hard switches section: each followed switch in plain words from the Role card's value.
 * Consult *person* and Ask me send the Agent to the consult tool first, whose answer is Allow once
 * or Deny for that one call, never "always" (spec §6).
 */
export function hardSwitchesSection(switches: FollowedHardSwitches): string {
  const lines = ORDER.map((key) => `- ${switchWords(key, switches[key])} ${NOT_THE_CALL[key]}`);
  const asks = ORDER.some((key) => asksFirst(switches[key]));
  const approval = asks
    ? "\n\nAn approval is for that one call: Allow once lets you make it once, and Deny means you don't make it; go on without it, or end the Stage failed with the reason if you can't. Ask again for the next call."
    : "";
  return `## Hard switches\n\n${lines.join("\n")}${approval}`;
}

function switchWords(key: FollowedHardSwitchKey, value: FollowedHardSwitchValue): string {
  const call = CALLS[key];
  switch (value.kind) {
    case "allowed":
      return `You may ${call} without asking.`;
    case "consult":
      return `Before you ${call}, consult ${value.person} first: ask approval of the call with consult, naming ${value.person}, and make it only once the answer is Allow once.`;
    case "ask-me":
      return `Before you ${call}, ask the user first: ask approval of the call with consult, naming no person, and make it only once the answer is Allow once.`;
    case "never":
      return `You may not ${call}: it is not allowed for your Role, and nobody can approve it. If the Stage can't be done without it, end the Stage failed with the reason.`;
  }
}

function asksFirst(value: FollowedHardSwitchValue): boolean {
  return value.kind === "consult" || value.kind === "ask-me";
}
