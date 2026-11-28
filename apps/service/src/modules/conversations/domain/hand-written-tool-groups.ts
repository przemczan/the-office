import {
  CARETAKER,
  isAuthorityGroup,
  type AuthorityGroup,
  type AuthorityInEffect,
} from "../../people/index.domain.js";
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
  propose_project: "projectSettings",
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
 * hires them back; it onboards no Project, installs no skill from a Source and checks no
 * environment. Applied by the offering, in one place, since the groups are shared with people who do.
 */
export const CARETAKER_NEVER_TOOLS: ReadonlySet<string> = new Set([
  "let_go_role",
  "hire_back_role",
  "propose_project",
  "run_environment_check",
]);

/**
 * The only tools of five groups the Caretaker is offered (spec 2.2 › Caretaker): its fixed
 * Authority holds each of these groups at Proposal, but it drafts only a new skill, a Pipeline's or
 * Stage template's new flow or Stage, a Project Pipeline's copy or change and a Prompt template's
 * text or reset, and the Office-wide limit, size threshold, Office instructions or a duty holder,
 * never a switch, a delete, an apply, a Project setting or any other Office setting. Every other
 * tool of these groups is Never for it, so its offered set is its old drafting tools' replacements and no more.
 * Applied by the offering, in one place, like `CARETAKER_NEVER_TOOLS`.
 */
export const CARETAKER_ONLY_TOOLS: Readonly<Partial<Record<AuthorityGroup, ReadonlySet<string>>>> =
  {
    skills: new Set(["write_skill"]),
    pipelinesAndStageTemplates: new Set([
      "add_library_pipeline",
      "change_library_pipeline",
      "add_stage_template",
      "change_stage_template",
    ]),
    projectSettings: new Set(["create_project_pipeline", "change_project_pipeline"]),
    promptTemplates: new Set(["save_prompt_template", "reset_prompt_template"]),
    officeSettings: new Set([
      "set_office_wide_limit",
      "set_size_threshold",
      "set_office_instructions",
      "set_duty_holder",
    ]),
  };

/**
 * `names` without the tools the Caretaker is never offered, when `roleKey` is the Caretaker's: those
 * in `CARETAKER_NEVER_TOOLS`, and those of a group of `CARETAKER_ONLY_TOOLS` it isn't limited to
 * (`groupOf` says each tool's group).
 */
export function withoutCaretakerNever(
  roleKey: string,
  names: readonly string[],
  groupOf: ReadonlyMap<string, AuthorityGroup> = new Map(),
): string[] {
  if (roleKey !== CARETAKER) return [...names];
  return names.filter((name) => {
    if (CARETAKER_NEVER_TOOLS.has(name)) return false;
    const group = groupOf.get(name);
    const only = group === undefined ? undefined : CARETAKER_ONLY_TOOLS[group];
    return only === undefined || only.has(name);
  });
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
 * and for the Caretaker without the tools it is never offered (`CARETAKER_NEVER_TOOLS`,
 * `CARETAKER_ONLY_TOOLS`). A Stage's
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
  return withoutCaretakerNever(
    roleKey,
    offeredTools(named, groupOf, authority, ownWorkGroupOf),
    groupOf,
  );
}
