import { OFFICE_ACTIONS } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import {
  authorityInEffect,
  CARETAKER,
  type Authority,
  type AuthorityInEffect,
} from "../../people/index.js";
import {
  CARETAKER_NEVER_TOOLS,
  HAND_WRITTEN_TOOL_GROUPS,
  offeredToPerson,
} from "./hand-written-tool-groups.js";
import {
  caretakerChatOfficeTools,
  chatOfficeTools,
  PERSON_OFFICE_TOOLS,
  STAGE_AUTHORITY_OFFICE_TOOLS,
} from "./session-instructions.js";

const ACTION_TOOLS = OFFICE_ACTIONS.map(({ name, group, onOwnWork }) => ({
  name,
  group,
  ...(onOwnWork && { onOwnWork }),
}));
const ACTION_NAMES = new Set(ACTION_TOOLS.map(({ name }) => name));

/** The Authority group of an Office action by its tool's name. */
function groupOf(name: string): string | undefined {
  return ACTION_TOOLS.find((tool) => tool.name === name)?.group;
}

/** The tools of a person's chat as their Authority leaves them, the Office actions' beside the chat's own. */
function chatOf(roleKey: string, authority: AuthorityInEffect): string[] {
  return offeredToPerson(
    roleKey,
    authority,
    roleKey === CARETAKER ? caretakerChatOfficeTools() : chatOfficeTools(),
    ACTION_TOOLS,
    { stageThread: false },
  );
}

/** The tools of a Stage's Thread, as the Devops preset's Authority with `set` leaves them. */
function stageTools(set: Authority): string[] {
  return offeredToPerson(
    "devops",
    authorityInEffect("devops", set),
    STAGE_AUTHORITY_OFFICE_TOOLS,
    ACTION_TOOLS,
    { stageThread: true },
  );
}

const NEVER = { kind: "never" } as const;
const PROPOSAL = { kind: "proposal" } as const;
const OWN_ALLOWED_OTHERS_ASK_ME = {
  kind: "own-and-others",
  own: { kind: "allowed" },
  others: { kind: "ask-me" },
} as const;

/** The Office tools each duty's holder was offered beside their Authority, before duties stopped granting tools. */
const FORMER_DUTY_TOOLS = {
  "default-person-to-talk-to": [
    "create_initiative",
    "propose_office_setting",
    "read_office_instructions",
    "list_prompt_templates",
    "read_prompt_template",
    "save_prompt_template",
    "reset_prompt_template",
    "post_link_card",
    "show_office_status",
  ],
  "shapes-initiatives": [
    "create_initiative",
    "write_initiative_outcome",
    "add_task",
    "change_task_title",
    "change_task_description",
    "choose_pipeline",
    "add_dependency",
    "remove_dependency",
    "add_to_initiative",
    "take_out_of_initiative",
  ],
  plans: ["add_dependency", "remove_dependency", "add_to_initiative", "take_out_of_initiative"],
  "onboards-projects": [
    "add_library_pipeline",
    "change_library_pipeline",
    "add_stage_template",
    "change_stage_template",
    "create_project_pipeline",
    "change_project_pipeline",
    "propose_project",
    "list_source_skills",
    "install_skill",
    "read_skill_update",
    "update_skill",
    "run_environment_check",
    "read_repository",
    "rerun_ci_run",
    "start_workflow",
  ],
} as const;

describe("the Office tools a person is offered", () => {
  it("name every hand-written tool's group in one place, each tool a candidate in a person's chat", () => {
    for (const tool of Object.keys(HAND_WRITTEN_TOOL_GROUPS)) {
      expect(PERSON_OFFICE_TOOLS).toContain(tool);
    }
  });

  it.each([
    ["default-person-to-talk-to", "office-manager", {}],
    ["shapes-initiatives", "cto", {}],
    ["onboards-projects", "devops", {}],
    // The Planner's table leaves Initiative records Never: hired, its card gives the job of Plans.
    ["plans", "planner", { initiativeRecords: OWN_ALLOWED_OTHERS_ASK_ME }],
  ] as const)(
    "offers whoever holds %s, on the %s preset's card, every tool the duty used to grant",
    (duty, roleKey, set) => {
      const offered = chatOf(roleKey, authorityInEffect(roleKey, set as Authority));

      for (const tool of FORMER_DUTY_TOOLS[duty]) expect(offered).toContain(tool);
    },
  );

  it("never offers the Default person to talk to create_task, as its Task records are Never", () => {
    expect(chatOf("office-manager", authorityInEffect("office-manager", {}))).not.toContain(
      "create_task",
    );
  });

  it("offers a Developer holding Onboards and repairs Projects none of its tools but the Core reading ones, once its rows are Never", () => {
    const authority = authorityInEffect("developer", {
      skills: NEVER,
      projectSettings: NEVER,
      pipelinesAndStageTemplates: NEVER,
      projectUpkeep: NEVER,
      runInstalls: NEVER,
    });

    const offered = chatOf("developer", authority);

    const core = ["read_repository", "list_source_skills", "read_skill_update"];
    const tools = FORMER_DUTY_TOOLS["onboards-projects"];
    expect(tools.filter((tool) => offered.includes(tool))).toEqual(
      tools.filter((tool) => core.includes(tool)),
    );
  });

  it("offers a Role the Default person's tools by its rows alone, whatever duty it holds", () => {
    // A Role from scratch, whose single tools are Never, is offered none of the duty's single tools.
    const offered = chatOf("release-manager", authorityInEffect("release-manager", {}));

    for (const tool of ["post_link_card", "show_office_status"]) {
      expect(offered).not.toContain(tool);
    }
    expect(offered).toContain("create_task");
  });

  it("narrows a Stage's setup tools by the Authority and never adds one it doesn't give", () => {
    expect(stageTools({ projectSettings: NEVER })).not.toContain("propose_project");

    const offered = stageTools({});

    expect(offered).toContain("propose_project");
    expect(offered).toContain("list_source_skills");
    expect(offered).not.toContain("rerun_ci_run");
    // The Office actions are never added to a Stage's list: only its own setup tools are.
    expect(offered).not.toContain("install_skill");
    expect(offered).not.toContain("add_library_pipeline");
  });
});

describe("the Caretaker's tools", () => {
  /** What the Caretaker's chat offered before duties stopped granting tools and Role cards had actions (git HEAD). */
  const OLD = [
    "list_projects",
    "list_people",
    "read_role",
    "list_tasks",
    "read_task",
    "list_ideas",
    "read_idea",
    "read_initiative",
    "read_attachment",
    "list_pipelines",
    "list_stage_templates",
    "read_stage_history",
    "read_threads",
    "answer_decision",
    "capture_idea",
    "create_task",
    "propose_skill",
    "propose_office_setup",
    "propose_role",
    "propose_office_setting",
    "read_office_instructions",
    "list_prompt_templates",
    "read_prompt_template",
    "propose_prompt_template",
    "propose_prompt_template_reset",
    "propose_library_pipeline",
    "propose_project_pipeline",
    "propose_stage_template",
    "consult",
    "open_decision",
  ];

  /**
   * What replaces each: propose_role gave way to hiring and changing a card, both Proposals, and the
   * drafting tools of skills, Pipelines, Stage templates and Prompt templates to their Office actions.
   */
  const REPLACED_BY: Readonly<Record<string, readonly string[]>> = {
    propose_role: ["hire_role", "change_role_card"],
    propose_skill: ["write_skill"],
    propose_library_pipeline: ["add_library_pipeline", "change_library_pipeline"],
    propose_stage_template: ["add_stage_template", "change_stage_template"],
    propose_project_pipeline: ["create_project_pipeline", "change_project_pipeline"],
    propose_prompt_template: ["save_prompt_template"],
    propose_prompt_template_reset: ["reset_prompt_template"],
  };

  /** The tools of the four narrowed groups the Caretaker is offered, which are its old tools' replacements. */
  const NARROWED_GROUPS = [
    "skills",
    "pipelinesAndStageTemplates",
    "projectSettings",
    "promptTemplates",
  ];
  const REPLACEMENTS = Object.entries(REPLACED_BY)
    .filter(([old]) => old !== "propose_role")
    .flatMap(([, replacements]) => replacements);

  const authority = authorityInEffect(CARETAKER, {});
  const offered = chatOf(CARETAKER, authority);
  const handWritten = offered.filter((name) => !ACTION_NAMES.has(name));
  const actions = offered.filter((name) => ACTION_NAMES.has(name));

  it("offers each tool it had, each retired one replaced by its Office actions", () => {
    const expected = OLD.flatMap((name) => REPLACED_BY[name] ?? [name]);

    for (const name of expected) expect(offered).toContain(name);
  });

  it("adds nothing but the reading tools every session has now", () => {
    const retired = Object.keys(REPLACED_BY);
    const expected = new Set([
      ...OLD.filter((name) => !retired.includes(name)),
      // Core reading tools: the repository, a Source's skills and an installed skill's update.
      "read_repository",
      "list_source_skills",
      "read_skill_update",
    ]);

    expect(new Set(handWritten)).toEqual(expected);
  });

  it("is offered of skills, Pipelines and Stage templates, Project settings and Prompt templates exactly its old tools' replacements, never a switch, delete, apply, copy, install or other setting", () => {
    const inNarrowedGroups = ACTION_TOOLS.filter(({ group }) => NARROWED_GROUPS.includes(group));

    expect(inNarrowedGroups.map(({ name }) => name)).toEqual(expect.arrayContaining(REPLACEMENTS));
    expect(
      inNarrowedGroups.map(({ name }) => name).filter((name) => actions.includes(name)),
    ).toEqual(
      inNarrowedGroups.map(({ name }) => name).filter((name) => REPLACEMENTS.includes(name)),
    );
    expect(new Set(actions.filter((name) => REPLACEMENTS.includes(name)))).toEqual(
      new Set(REPLACEMENTS),
    );
    for (const never of [
      "edit_skill",
      "install_skill",
      "update_skill",
      "change_skill_state",
      "change_skill_everyone",
      "change_skill_roles",
      "delete_skill",
      "copy_library_pipeline",
      "delete_library_pipeline",
      "apply_stage_template",
      "delete_stage_template",
      "delete_project_pipeline",
      "change_project_settings",
    ]) {
      expect(offered).not.toContain(never);
    }
  });

  it("is offered no tool of the MCP servers group, nor of any other group the old tools didn't reach", () => {
    const allowed = new Set([...REPLACEMENTS, "hire_role", "change_role_card"]);
    const extra = actions.filter(
      (name) => !allowed.has(name) && NARROWED_GROUPS.includes(groupOf(name) ?? ""),
    );

    expect(extra).toEqual([]);
    expect(actions.filter((name) => groupOf(name) === "mcpServers")).toEqual([]);
  });

  it("is offered no Office action of the Change Roles group but hiring and changing a card", () => {
    const changeRoles = ACTION_TOOLS.filter(({ group }) => group === "changeRoles").map(
      ({ name }) => name,
    );

    expect(changeRoles.filter((name) => actions.includes(name))).toEqual([
      "hire_role",
      "change_role_card",
    ]);
    for (const never of ["let_go_role", "hire_back_role"]) {
      expect(CARETAKER_NEVER_TOOLS.has(never)).toBe(true);
      expect(offered).not.toContain(never);
    }
  });

  it("narrows the four groups only for the Caretaker: a Role holding them at Proposal is offered the rest", () => {
    const devops = chatOf("devops", authorityInEffect("devops", {}));

    for (const tool of ["edit_skill", "install_skill", "copy_library_pipeline", "write_skill"]) {
      expect(devops).toContain(tool);
    }
  });

  it("is never offered the tools of a job it has none of", () => {
    for (const tool of [
      "post_link_card",
      "show_office_status",
      "create_initiative",
      "propose_project",
      "run_environment_check",
      // The retired propose tools, which no tool of any group stands for now.
      "propose_skill",
      "propose_skill_install",
      "propose_skill_update",
      "propose_library_pipeline",
      "propose_project_pipeline",
      "propose_stage_template",
      "propose_prompt_template",
      "propose_prompt_template_reset",
    ]) {
      expect(offered).not.toContain(tool);
    }
  });

  it("keeps its Authority fixed at Proposal for Change Roles and for the four narrowed groups", () => {
    expect(authority.changeRoles).toEqual(PROPOSAL);
    for (const group of NARROWED_GROUPS) {
      expect(authority[group as keyof typeof authority]).toEqual(PROPOSAL);
    }
  });
});
