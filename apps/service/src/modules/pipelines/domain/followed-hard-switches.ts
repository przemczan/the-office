import {
  flagField,
  promptTemplate,
  type PromptTexts,
} from "../../prompt-templates/index.domain.js";

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

/** The Brief's Hard switches section, which tells each followed switch as its Role card gives it. */
export const HARD_SWITCHES = promptTemplate({
  key: "pipelines.hard-switches",
  domain: "pipelines",
  name: "Hard switches in the Brief",
  description:
    "The section of an Agent Stage's Brief that tells the Agent what its Role card allows, asks about first or forbids.",
  variables: {
    switches: {
      kind: "list",
      description:
        "The Hard switches the Agent follows, in order. Each has the call it governs and what the switch leaves out, and exactly one of allowed, consult, askMe and never is filled in (the others are empty).",
      fields: {
        call: 'What the switch governs, to follow "You may" or "Before you".',
        notTheCall: "What the switch leaves out, so the Agent doesn't ask for its ordinary work.",
        person: "Whom the Agent consults first; filled in only when consult is.",
        allowed: "Filled in when the Agent may make the call freely.",
        consult: "Filled in when the Agent consults a person first.",
        askMe: "Filled in when the Agent asks the user first.",
        never: "Filled in when the call is not allowed.",
      },
    },
    asksFirst: {
      kind: "flag",
      description: "Whether any switch has the Agent consult or ask the user first.",
    },
  },
  text: `## Hard switches

{{#switches}}
- {{#allowed}}You may {{call}} without asking.{{/allowed}}{{#consult}}Before you {{call}}, consult {{person}} first: ask approval of the call with consult, naming {{person}}, and make it only once the answer is Allow once.{{/consult}}{{#askMe}}Before you {{call}}, ask the user first: ask approval of the call with consult, naming no person, and make it only once the answer is Allow once.{{/askMe}}{{#never}}You may not {{call}}: it is not allowed for your Role, and nobody can approve it. If the Stage can't be done without it, end the Stage failed with the reason.{{/never}} {{notTheCall}}
{{/switches}}
{{#asksFirst}}

An approval is for that one call: Allow once lets you make it once, and Deny means you don't make it; go on without it, or end the Stage failed with the reason if you can't. Ask again for the next call.
{{/asksFirst}}`,
});

/**
 * The brief's Hard switches section: each followed switch in plain words from the Role card's value.
 * Consult *person* and Ask me send the Agent to the consult tool first, whose answer is Allow once
 * or Deny for that one call, never "always" (spec §6).
 */
export function hardSwitchesSection(prompts: PromptTexts, switches: FollowedHardSwitches): string {
  const items = ORDER.map((key) => {
    const value = switches[key];
    return {
      call: CALLS[key],
      notTheCall: NOT_THE_CALL[key],
      person: value.kind === "consult" ? value.person : "",
      allowed: flagField(value.kind === "allowed"),
      consult: flagField(value.kind === "consult"),
      askMe: flagField(value.kind === "ask-me"),
      never: flagField(value.kind === "never"),
    };
  });
  const asksFirst = ORDER.some((key) => asksFirstOf(switches[key]));
  // The list's lines each end in a line break, which the section doesn't keep.
  return prompts.render(HARD_SWITCHES, { switches: items, asksFirst }).trimEnd();
}

function asksFirstOf(value: FollowedHardSwitchValue): boolean {
  return value.kind === "consult" || value.kind === "ask-me";
}
