import {
  CAPTURE_IDEA_TOOL,
  PROPOSE_LIBRARY_PIPELINE_TOOL as CONTRACT_PROPOSE_LIBRARY_PIPELINE_TOOL,
  PROPOSE_PROJECT_COMMANDS_TOOL as CONTRACT_PROPOSE_PROJECT_COMMANDS_TOOL,
  PROPOSE_PROJECT_TOOL as CONTRACT_PROPOSE_PROJECT_TOOL,
  PROPOSE_SKILL_INSTALL_TOOL as CONTRACT_PROPOSE_SKILL_INSTALL_TOOL,
  PROPOSE_SKILL_TOOL as CONTRACT_PROPOSE_SKILL_TOOL,
  PROPOSE_SKILL_UPDATE_TOOL as CONTRACT_PROPOSE_SKILL_UPDATE_TOOL,
  SHOW_OFFICE_STATUS_TOOL as CONTRACT_SHOW_OFFICE_STATUS_TOOL,
} from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import { DEVOPS, OFFICE_MANAGER } from "../../people/index.js";
import {
  CHANGE_ROLE_TOOL,
  CHAT_OFFICE_TOOLS,
  chatInstructions,
  chatOfficeTools,
  LIST_PIPELINES_TOOL,
  LIST_SOURCE_SKILLS_TOOL,
  POST_LINK_CARD_TOOL,
  PROPOSE_OFFICE_SETTING_TOOL,
  PROPOSE_LIBRARY_PIPELINE_TOOL,
  PROPOSE_PROJECT_COMMANDS_TOOL,
  PROPOSE_PROJECT_TOOL,
  PROPOSE_ROLE_TOOL,
  PROPOSE_SKILL_INSTALL_TOOL,
  PROPOSE_SKILL_TOOL,
  PROPOSE_SKILL_UPDATE_TOOL,
  READ_REPOSITORY_TOOL,
  READ_SKILL_UPDATE_TOOL,
  roleOfficeTools,
  SHOW_OFFICE_STATUS_TOOL,
} from "./session-instructions.js";

describe("chatInstructions", () => {
  const card = { name: "Nina", title: "Devops", responsibilities: "", instructions: "" };

  it("tells Devops to read a repository that is not a Project yet only with its tool", () => {
    expect(chatInstructions(card, DEVOPS)).toContain(
      `Read, Grep, Glob and the shell are refused there. Read it only with ${READ_REPOSITORY_TOOL}`,
    );
    expect(chatInstructions(card, "planner")).not.toContain(READ_REPOSITORY_TOOL);
  });

  it("tells Devops to onboard a repository on a host by its Repository URL", () => {
    expect(chatInstructions(card, DEVOPS)).toContain(
      "onboarded by that URL: The Office clones it when the user applies the Proposal.",
    );
  });
});

describe("chatOfficeTools", () => {
  it("gives a person's chat every chat tool", () => {
    expect(chatOfficeTools("planner")).toEqual(CHAT_OFFICE_TOOLS);
  });

  it("leaves creating a Task out of the Office Manager's, who points to the Planner", () => {
    const tools = chatOfficeTools(OFFICE_MANAGER);

    expect(tools).not.toContain("create_task");
    expect(tools).toContain("capture_idea");
  });

  it("gives the Office Manager drafting Roles and Office settings as Proposals, never changing one", () => {
    const tools = chatOfficeTools(OFFICE_MANAGER);

    expect(tools).toContain(PROPOSE_ROLE_TOOL);
    expect(tools).toContain(PROPOSE_OFFICE_SETTING_TOOL);
    expect(tools).not.toContain(CHANGE_ROLE_TOOL);
    expect(chatOfficeTools("planner")).not.toContain(PROPOSE_ROLE_TOOL);
    expect(chatOfficeTools("planner")).not.toContain(PROPOSE_OFFICE_SETTING_TOOL);
  });

  it("gives everyone reading an Initiative by its id, the Office Manager too", () => {
    expect(chatOfficeTools("planner")).toContain("read_initiative");
    expect(chatOfficeTools(DEVOPS)).toContain("read_initiative");
    expect(chatOfficeTools(OFFICE_MANAGER)).toContain("read_initiative");
  });

  it("gives only Devops' chat reading a repository on the workstation, never their Stage Threads", () => {
    expect(chatOfficeTools(DEVOPS)).toContain(READ_REPOSITORY_TOOL);
    expect(roleOfficeTools(DEVOPS)).not.toContain(READ_REPOSITORY_TOOL);
    expect(chatOfficeTools("planner")).not.toContain(READ_REPOSITORY_TOOL);
  });

  it("gives everyone drafting a written skill as a Proposal, the Office Manager too", () => {
    expect(chatOfficeTools("planner")).toContain(PROPOSE_SKILL_TOOL);
    expect(chatOfficeTools(DEVOPS)).toContain(PROPOSE_SKILL_TOOL);
    expect(chatOfficeTools(OFFICE_MANAGER)).toContain(PROPOSE_SKILL_TOOL);
  });

  it("gives Devops reading the library and drafting Project commands, Pipelines, Projects and skill installs and updates as Proposals", () => {
    expect(chatOfficeTools(DEVOPS)).toEqual([
      ...CHAT_OFFICE_TOOLS,
      LIST_PIPELINES_TOOL,
      PROPOSE_PROJECT_COMMANDS_TOOL,
      PROPOSE_LIBRARY_PIPELINE_TOOL,
      PROPOSE_PROJECT_TOOL,
      LIST_SOURCE_SKILLS_TOOL,
      PROPOSE_SKILL_INSTALL_TOOL,
      READ_SKILL_UPDATE_TOOL,
      PROPOSE_SKILL_UPDATE_TOOL,
      READ_REPOSITORY_TOOL,
    ]);
    expect(chatOfficeTools("planner")).not.toContain(PROPOSE_LIBRARY_PIPELINE_TOOL);
    expect(chatOfficeTools("planner")).not.toContain(PROPOSE_SKILL_INSTALL_TOOL);
    expect(chatOfficeTools("planner")).not.toContain(PROPOSE_SKILL_UPDATE_TOOL);
  });

  it("names the Proposal tools as the web does", () => {
    expect(PROPOSE_PROJECT_COMMANDS_TOOL).toBe(CONTRACT_PROPOSE_PROJECT_COMMANDS_TOOL);
    expect(PROPOSE_LIBRARY_PIPELINE_TOOL).toBe(CONTRACT_PROPOSE_LIBRARY_PIPELINE_TOOL);
    expect(PROPOSE_PROJECT_TOOL).toBe(CONTRACT_PROPOSE_PROJECT_TOOL);
    expect(PROPOSE_SKILL_INSTALL_TOOL).toBe(CONTRACT_PROPOSE_SKILL_INSTALL_TOOL);
    expect(PROPOSE_SKILL_UPDATE_TOOL).toBe(CONTRACT_PROPOSE_SKILL_UPDATE_TOOL);
    expect(PROPOSE_SKILL_TOOL).toBe(CONTRACT_PROPOSE_SKILL_TOOL);
  });

  it("gives only the Office Manager posting Link cards", () => {
    expect(chatOfficeTools(OFFICE_MANAGER)).toContain(POST_LINK_CARD_TOOL);
    expect(chatOfficeTools("planner")).not.toContain(POST_LINK_CARD_TOOL);
  });

  it("gives only the Office Manager showing the Office status", () => {
    expect(chatOfficeTools(OFFICE_MANAGER)).toContain(SHOW_OFFICE_STATUS_TOOL);
    expect(chatOfficeTools("planner")).not.toContain(SHOW_OFFICE_STATUS_TOOL);
  });

  it("names the tools whose calls the web shows as cards as the contracts name them", () => {
    expect(SHOW_OFFICE_STATUS_TOOL).toBe(CONTRACT_SHOW_OFFICE_STATUS_TOOL);
    expect(CHAT_OFFICE_TOOLS).toContain(CAPTURE_IDEA_TOOL);
  });
});
