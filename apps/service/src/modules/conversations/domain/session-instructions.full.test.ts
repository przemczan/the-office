import {
  CAPTURE_IDEA_TOOL,
  OPEN_DECISION_TOOL,
  PROPOSE_LIBRARY_PIPELINE_TOOL as CONTRACT_PROPOSE_LIBRARY_PIPELINE_TOOL,
  PROPOSE_PROJECT_COMMANDS_TOOL as CONTRACT_PROPOSE_PROJECT_COMMANDS_TOOL,
  PROPOSE_PROJECT_TOOL as CONTRACT_PROPOSE_PROJECT_TOOL,
  PROPOSE_SKILL_INSTALL_TOOL as CONTRACT_PROPOSE_SKILL_INSTALL_TOOL,
  PROPOSE_SKILL_TOOL as CONTRACT_PROPOSE_SKILL_TOOL,
  PROPOSE_SKILL_UPDATE_TOOL as CONTRACT_PROPOSE_SKILL_UPDATE_TOOL,
  PROPOSE_STAGE_TEMPLATE_TOOL as CONTRACT_PROPOSE_STAGE_TEMPLATE_TOOL,
  SHOW_OFFICE_STATUS_TOOL as CONTRACT_SHOW_OFFICE_STATUS_TOOL,
} from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import { DEVOPS, OFFICE_MANAGER } from "../../people/index.js";
import {
  caretakerChatInstructions,
  CHAT_OFFICE_TOOLS,
  chatInstructions,
  chatOfficeTools,
  CONSULTATION_OFFICE_TOOLS,
  consultationInstructions,
  LIST_PIPELINES_TOOL,
  LIST_SOURCE_SKILLS_TOOL,
  LIST_STAGE_TEMPLATES_TOOL,
  POST_LINK_CARD_TOOL,
  READ_ROLE_TOOL,
  PROPOSE_LIBRARY_PIPELINE_TOOL,
  PROPOSE_PROJECT_COMMANDS_TOOL,
  PROPOSE_PROJECT_TOOL,
  PROPOSE_SKILL_INSTALL_TOOL,
  PROPOSE_SKILL_TOOL,
  PROPOSE_SKILL_UPDATE_TOOL,
  PROPOSE_STAGE_TEMPLATE_TOOL,
  READ_REPOSITORY_TOOL,
  READ_SKILL_UPDATE_TOOL,
  READING_OFFICE_TOOLS,
  READ_STAGE_HISTORY_TOOL,
  roleOfficeTools,
  SHOW_OFFICE_STATUS_TOOL,
  workThreadInstructions,
} from "./session-instructions.js";

describe("chatInstructions", () => {
  const nina = {
    card: { name: "Nina", title: "Devops", responsibilities: "", instructions: "" },
    officeInstructions: "",
  };

  it("tells Devops to read a repository that is not a Project yet only with its tool", () => {
    expect(chatInstructions(nina, DEVOPS)).toContain(
      `Read, Grep, Glob and the shell are refused there. Read it only with ${READ_REPOSITORY_TOOL}`,
    );
    expect(chatInstructions(nina, "planner")).not.toContain(READ_REPOSITORY_TOOL);
  });

  it("tells Devops to onboard a repository on a host by its Repository URL", () => {
    expect(chatInstructions(nina, DEVOPS)).toContain(
      "onboarded by that URL: The Office clones it when the user applies the Proposal.",
    );
  });
});

describe("the Office instructions in a session's standing instructions", () => {
  const card = {
    name: "Ada",
    title: "Developer",
    responsibilities: "Builds what a Task asks for.",
    instructions: "Write the test first.",
  };
  const whoTheyAre =
    "You are Ada, the Developer in The Office, where people like you work with the user on their Projects. Builds what a Task asks for.";

  describe.each([
    {
      kind: "a chat",
      standing: (officeInstructions: string) =>
        chatInstructions({ card, officeInstructions }, "developer"),
      theRest: "In your chat you read and answer",
    },
    {
      kind: "the Caretaker's chat, only reading",
      standing: (officeInstructions: string) =>
        caretakerChatInstructions({ card, officeInstructions }, false),
      theRest: "This Thread only reads until the user allows changes",
    },
    {
      kind: "the Caretaker's chat with changes allowed",
      standing: (officeInstructions: string) =>
        caretakerChatInstructions({ card, officeInstructions }, true),
      theRest: "The user allowed changes in this Thread",
    },
    {
      kind: "a Task or Initiative Thread, or an Agent Stage",
      standing: (officeInstructions: string) =>
        workThreadInstructions({ card, officeInstructions }, "You work a Stage."),
      theRest: "You work a Stage.",
    },
    {
      kind: "a Consultation",
      standing: (officeInstructions: string) =>
        consultationInstructions({ card, officeInstructions }),
      theRest: "You are in a Consultation",
    },
  ])("in $kind", ({ standing, theRest }) => {
    it("say that the Role's instructions and a Project's own CLAUDE.md win where they disagree", () => {
      expect(standing("Answer in plain words.")).toContain(
        "Where they disagree, your Role's instructions and a Project's own CLAUDE.md win.",
      );
    });

    it("add nothing when empty, not even the heading", () => {
      const text = standing("");

      expect(text.startsWith(`${whoTheyAre}\n\nWrite the test first.\n\n${theRest}`)).toBe(true);
      expect(text).not.toContain("Office instructions");
      expect(text).not.toContain("## Your Role's instructions");
      expect(text).not.toContain("CLAUDE.md");
    });
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

  it("gives every chat every reading tool, the Office Manager's too", () => {
    for (const roleKey of ["planner", DEVOPS, OFFICE_MANAGER]) {
      expect(chatOfficeTools(roleKey)).toEqual(expect.arrayContaining([...READING_OFFICE_TOOLS]));
    }
    expect(READING_OFFICE_TOOLS).toContain(READ_ROLE_TOOL);
    expect(READING_OFFICE_TOOLS).toContain("read_initiative");
    expect(READING_OFFICE_TOOLS).toContain("read_attachment");
  });

  it("gives every chat reading a Task's Stage history, the Office Manager's too, which no Agent Stage reads with", () => {
    for (const roleKey of ["planner", DEVOPS, OFFICE_MANAGER]) {
      expect(chatOfficeTools(roleKey)).toContain(READ_STAGE_HISTORY_TOOL);
    }
    expect(READING_OFFICE_TOOLS).not.toContain(READ_STAGE_HISTORY_TOOL);
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

  it("gives Devops reading the library and drafting Project commands, Pipelines, Stage templates, Projects and skill installs and updates as Proposals", () => {
    expect(chatOfficeTools(DEVOPS)).toEqual([
      ...CHAT_OFFICE_TOOLS,
      LIST_PIPELINES_TOOL,
      PROPOSE_PROJECT_COMMANDS_TOOL,
      PROPOSE_LIBRARY_PIPELINE_TOOL,
      LIST_STAGE_TEMPLATES_TOOL,
      PROPOSE_STAGE_TEMPLATE_TOOL,
      PROPOSE_PROJECT_TOOL,
      LIST_SOURCE_SKILLS_TOOL,
      PROPOSE_SKILL_INSTALL_TOOL,
      READ_SKILL_UPDATE_TOOL,
      PROPOSE_SKILL_UPDATE_TOOL,
      READ_REPOSITORY_TOOL,
    ]);
    expect(chatOfficeTools("planner")).not.toContain(PROPOSE_LIBRARY_PIPELINE_TOOL);
    expect(chatOfficeTools("planner")).not.toContain(PROPOSE_STAGE_TEMPLATE_TOOL);
    expect(chatOfficeTools("planner")).not.toContain(PROPOSE_SKILL_INSTALL_TOOL);
    expect(chatOfficeTools("planner")).not.toContain(PROPOSE_SKILL_UPDATE_TOOL);
  });

  it("names the Proposal tools as the web does", () => {
    expect(PROPOSE_PROJECT_COMMANDS_TOOL).toBe(CONTRACT_PROPOSE_PROJECT_COMMANDS_TOOL);
    expect(PROPOSE_LIBRARY_PIPELINE_TOOL).toBe(CONTRACT_PROPOSE_LIBRARY_PIPELINE_TOOL);
    expect(PROPOSE_STAGE_TEMPLATE_TOOL).toBe(CONTRACT_PROPOSE_STAGE_TEMPLATE_TOOL);
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

describe("CONSULTATION_OFFICE_TOOLS", () => {
  it("gives a Consultant every reading tool, and no Decision or Consultation of their own", () => {
    expect(CONSULTATION_OFFICE_TOOLS).toEqual(expect.arrayContaining([...READING_OFFICE_TOOLS]));
    expect(CONSULTATION_OFFICE_TOOLS).not.toContain(OPEN_DECISION_TOOL);
  });

  it("gives a Consultant reading the Task's Stage history", () => {
    expect(CONSULTATION_OFFICE_TOOLS).toContain(READ_STAGE_HISTORY_TOOL);
  });
});
