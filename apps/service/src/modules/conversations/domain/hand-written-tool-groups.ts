import {
  CARETAKER,
  isAuthorityGroup,
  type AuthorityGroup,
  type AuthorityInEffect,
} from "../../people/index.js";
import { offeredTools } from "./office-tool-ruling.js";

/**
 * The Authority group of each hand-written Office tool that follows one (spec 6 › Tool areas): the
 * tools no Office action declares (`officeAction()`), whose catalog home is here, the one place that
 * says it. A session is offered the tool unless its person's setting for the group is Never; the
 * tools that draft their own Proposal, or run their own checks, are not ruled any further, so
 * offered-ness is all the Authority decides for them. A tool in no row is Core: always offered where
 * its home offers it (the reading tools, `consult`, `open_decision`, `answer_decision`).
 */
export const HAND_WRITTEN_TOOL_GROUPS: Readonly<Record<string, AuthorityGroup>> = {
  create_task: "taskRecords",
  create_initiative: "initiativeRecords",
  capture_idea: "captureIdea",
  propose_skill: "skills",
  propose_skill_install: "skills",
  propose_skill_update: "skills",
  propose_office_setting: "officeSettings",
  propose_prompt_template: "promptTemplates",
  propose_prompt_template_reset: "promptTemplates",
  propose_library_pipeline: "pipelinesAndStageTemplates",
  propose_stage_template: "pipelinesAndStageTemplates",
  propose_project_pipeline: "projectSettings",
  propose_project: "projectSettings",
  propose_project_commands: "proposeProjectCommands",
  propose_test_targets: "proposeTestTargets",
  propose_actions: "proposeActions",
  run_environment_check: "runInstalls",
  post_link_card: "postLinkCard",
  show_office_status: "showOfficeStatus",
};

/** The group of `tool` when it is a hand-written tool that follows one. */
export function handWrittenGroupOf(tool: string): AuthorityGroup | undefined {
  return HAND_WRITTEN_TOOL_GROUPS[tool];
}

/**
 * The Office tools the Caretaker's fixed Authority would offer by its groups but its job never uses
 * (spec 2.2 › Caretaker): it hires and changes Roles as Proposals, but never lets a person go or
 * hires them back; its Library and Run installs rows keep its Pipeline and prompt drafting, but it
 * onboards no Project, installs no skill from a Source and checks no environment. Applied by the
 * offering, in one place, since the groups are shared with people who do.
 */
export const CARETAKER_NEVER_TOOLS: ReadonlySet<string> = new Set([
  "let_go_role",
  "hire_back_role",
  "propose_project",
  "propose_skill_install",
  "propose_skill_update",
  "run_environment_check",
]);

/** `names` without the tools the Caretaker is never offered, when `roleKey` is the Caretaker's. */
export function withoutCaretakerNever(roleKey: string, names: readonly string[]): string[] {
  return roleKey === CARETAKER
    ? names.filter((name) => !CARETAKER_NEVER_TOOLS.has(name))
    : [...names];
}

/** An Office action's tool as the registry lists it: its name and the Authority groups that rule it. */
export interface ActionTool {
  readonly name: string;
  readonly group: string;
  readonly onOwnWork?: string;
}

/**
 * The Office tools a person's session is offered (spec 6 › Tool areas): its home's, and for a
 * Thread the user talks in every Office action's tool beside them, all but those their Authority
 * leaves Never, whether an Office action's tool or a hand-written one (`HAND_WRITTEN_TOOL_GROUPS`),
 * and for the Caretaker without the tools it is never offered (`CARETAKER_NEVER_TOOLS`). A Stage's
 * fixed list (`stageThread`) is narrowed the same way, never widened (spec 2.3.1).
 */
export function offeredToPerson(
  roleKey: string,
  authority: AuthorityInEffect,
  homeTools: readonly string[],
  actionTools: readonly ActionTool[],
  { stageThread }: { readonly stageThread: boolean },
): string[] {
  const groupOf = new Map(
    actionTools.flatMap(({ name, group }) =>
      isAuthorityGroup(group) ? [[name, group] as const] : [],
    ),
  );
  // The hand-written tools' groups, which no Office action declares.
  for (const name of homeTools) {
    const group = handWrittenGroupOf(name);
    if (group !== undefined && !groupOf.has(name)) groupOf.set(name, group);
  }
  const named = stageThread
    ? [...homeTools]
    : [...new Set([...homeTools, ...actionTools.map(({ name }) => name)])];
  const ownWorkGroupOf = new Map(
    actionTools.flatMap(({ name, onOwnWork }) =>
      onOwnWork !== undefined && isAuthorityGroup(onOwnWork) ? [[name, onOwnWork] as const] : [],
    ),
  );
  return withoutCaretakerNever(roleKey, offeredTools(named, groupOf, authority, ownWorkGroupOf));
}
