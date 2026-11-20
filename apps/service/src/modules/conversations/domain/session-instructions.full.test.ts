import {
  CAPTURE_IDEA_TOOL,
  OPEN_DECISION_TOOL,
  PROPOSE_LIBRARY_PIPELINE_TOOL as CONTRACT_PROPOSE_LIBRARY_PIPELINE_TOOL,
  PROPOSE_PROJECT_COMMANDS_TOOL as CONTRACT_PROPOSE_PROJECT_COMMANDS_TOOL,
  PROPOSE_PROJECT_PIPELINE_TOOL as CONTRACT_PROPOSE_PROJECT_PIPELINE_TOOL,
  PROPOSE_PROJECT_TOOL as CONTRACT_PROPOSE_PROJECT_TOOL,
  PROPOSE_SKILL_INSTALL_TOOL as CONTRACT_PROPOSE_SKILL_INSTALL_TOOL,
  PROPOSE_SKILL_TOOL as CONTRACT_PROPOSE_SKILL_TOOL,
  PROPOSE_SKILL_UPDATE_TOOL as CONTRACT_PROPOSE_SKILL_UPDATE_TOOL,
  PROPOSE_PROMPT_TEMPLATE_RESET_TOOL as CONTRACT_PROPOSE_PROMPT_TEMPLATE_RESET_TOOL,
  PROPOSE_PROMPT_TEMPLATE_TOOL as CONTRACT_PROPOSE_PROMPT_TEMPLATE_TOOL,
  PROPOSE_STAGE_TEMPLATE_TOOL as CONTRACT_PROPOSE_STAGE_TEMPLATE_TOOL,
  PROPOSE_TEST_TARGETS_TOOL as CONTRACT_PROPOSE_TEST_TARGETS_TOOL,
  SHOW_OFFICE_STATUS_TOOL as CONTRACT_SHOW_OFFICE_STATUS_TOOL,
} from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import {
  CHAT_OFFICE_TOOLS,
  CREATE_INITIATIVE_TOOL,
  chatOfficeTools,
  CONSULT_TOOL,
  consultationOfficeTools,
  LIST_PIPELINES_TOOL,
  LIST_SOURCE_SKILLS_TOOL,
  LIST_STAGE_TEMPLATES_TOOL,
  POST_LINK_CARD_TOOL,
  READ_ROLE_TOOL,
  PROPOSE_LIBRARY_PIPELINE_TOOL,
  PROPOSE_PROJECT_COMMANDS_TOOL,
  PROPOSE_PROJECT_PIPELINE_TOOL,
  PROPOSE_PROJECT_TOOL,
  PROPOSE_SKILL_INSTALL_TOOL,
  PROPOSE_SKILL_TOOL,
  PROPOSE_SKILL_UPDATE_TOOL,
  PROPOSE_PROMPT_TEMPLATE_RESET_TOOL,
  PROPOSE_PROMPT_TEMPLATE_TOOL,
  PROPOSE_STAGE_TEMPLATE_TOOL,
  PROPOSE_TEST_TARGETS_TOOL,
  READ_REPOSITORY_TOOL,
  READ_SKILL_UPDATE_TOOL,
  READING_OFFICE_TOOLS,
  READ_STAGE_HISTORY_TOOL,
  roleOfficeTools,
  SHOW_OFFICE_STATUS_TOOL,
  type HeldDuties,
  WRITING_FOR_THE_USER_RULE,
} from "./session-instructions.js";
import { defaultPromptTexts } from "../../prompt-templates/index.js";
import { CONVERSATIONS_PROMPT_TEMPLATES } from "./conversations-prompt-templates.js";
import {
  caretakerChatInstructions,
  chatInstructions,
  consultationInstructions,
  workThreadInstructions,
} from "./session-instruction-templates.js";

const PROMPTS = defaultPromptTexts(CONVERSATIONS_PROMPT_TEMPLATES);

/** The duties each default Role holds while nobody moved them; the Caretaker holds none. */
const OFFICE_MANAGER: HeldDuties = ["default-person-to-talk-to"];
const CTO: HeldDuties = ["shapes-initiatives", "asked-first-when-out-of-tries"];
const DEVOPS: HeldDuties = ["onboards-projects", "mcp-tool-consultant"];
const PLANNER: HeldDuties = ["plans"];
const DEVELOPER: HeldDuties = ["implements"];
const CARETAKER: HeldDuties = [];

describe("chatInstructions", () => {
  const nina = {
    card: { name: "Nina", title: "Devops", responsibilities: "", instructions: "" },
    officeInstructions: "",
  };

  it("tells Devops to read a repository that is not a Project yet only with its tool", () => {
    expect(chatInstructions(PROMPTS, nina, DEVOPS)).toContain(
      `Read, Grep, Glob and the shell are refused there. Read it only with ${READ_REPOSITORY_TOOL}`,
    );
    expect(chatInstructions(PROMPTS, nina, PLANNER)).not.toContain(READ_REPOSITORY_TOOL);
  });

  it("tells Devops to onboard a repository on a host by its Repository URL", () => {
    expect(chatInstructions(PROMPTS, nina, DEVOPS)).toContain(
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
        chatInstructions(PROMPTS, { card, officeInstructions }, DEVELOPER),
      theRest: "In your chat you read and answer",
    },
    {
      kind: "the Caretaker's chat, only reading",
      standing: (officeInstructions: string) =>
        caretakerChatInstructions(PROMPTS, { card, officeInstructions }, false),
      theRest: "This Thread only reads until the user allows changes",
    },
    {
      kind: "the Caretaker's chat with changes allowed",
      standing: (officeInstructions: string) =>
        caretakerChatInstructions(PROMPTS, { card, officeInstructions }, true),
      theRest: "The user allowed changes in this Thread",
    },
    {
      kind: "a Task or Initiative Thread, or an Agent Stage",
      standing: (officeInstructions: string) =>
        workThreadInstructions(PROMPTS, { card, officeInstructions }, "You work a Stage."),
      theRest: "You work a Stage.",
    },
    {
      kind: "a Consultation",
      standing: (officeInstructions: string) =>
        consultationInstructions(PROMPTS, { card, officeInstructions }, true),
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

      expect(
        text.startsWith(
          `${whoTheyAre}\n\nWrite the test first.\n\n${WRITING_FOR_THE_USER_RULE}\n\n${theRest}`,
        ),
      ).toBe(true);
      expect(text).not.toContain("Office instructions");
      expect(text).not.toContain("## Your Role's instructions");
      expect(text).not.toContain("CLAUDE.md");
    });
  });
});

describe("chatOfficeTools", () => {
  it("gives a person's chat every chat tool", () => {
    expect(chatOfficeTools(PLANNER)).toEqual([...CHAT_OFFICE_TOOLS, CONSULT_TOOL]);
  });

  it("leaves creating a Task out of the Office Manager's, who points to the Planner", () => {
    const tools = chatOfficeTools(OFFICE_MANAGER);

    expect(tools).not.toContain("create_task");
    expect(tools).toContain("capture_idea");
  });

  it("gives creating an Initiative to the CTO's and the Office Manager's chats alone", () => {
    expect(chatOfficeTools(CTO)).toContain(CREATE_INITIATIVE_TOOL);
    expect(chatOfficeTools(OFFICE_MANAGER)).toContain(CREATE_INITIATIVE_TOOL);
    for (const held of [PLANNER, DEVELOPER, DEVOPS, CARETAKER]) {
      expect(chatOfficeTools(held)).not.toContain(CREATE_INITIATIVE_TOOL);
    }
    expect(CHAT_OFFICE_TOOLS).not.toContain(CREATE_INITIATIVE_TOOL);
  });

  it("leaves creating an Initiative out of the CTO's and the Office Manager's Stage and Consultation tools", () => {
    expect(roleOfficeTools(CTO)).not.toContain(CREATE_INITIATIVE_TOOL);
    expect(roleOfficeTools(OFFICE_MANAGER)).not.toContain(CREATE_INITIATIVE_TOOL);
    for (const held of [CTO, OFFICE_MANAGER]) {
      expect(consultationOfficeTools(held, true)).not.toContain(CREATE_INITIATIVE_TOOL);
    }
  });

  it("gives every chat every reading tool, the Office Manager's too", () => {
    for (const held of [PLANNER, DEVOPS, OFFICE_MANAGER]) {
      expect(chatOfficeTools(held)).toEqual(expect.arrayContaining([...READING_OFFICE_TOOLS]));
    }
    expect(READING_OFFICE_TOOLS).toContain(READ_ROLE_TOOL);
    expect(READING_OFFICE_TOOLS).toContain("read_initiative");
    expect(READING_OFFICE_TOOLS).toContain("read_attachment");
  });

  it("gives every chat reading a Task's Stage history, the Office Manager's too, apart from the reading tools every session has", () => {
    for (const held of [PLANNER, DEVOPS, OFFICE_MANAGER]) {
      expect(chatOfficeTools(held)).toContain(READ_STAGE_HISTORY_TOOL);
    }
    expect(READING_OFFICE_TOOLS).not.toContain(READ_STAGE_HISTORY_TOOL);
  });

  it("keeps the reading tools every session has to the records, so planning and Initiative Threads read no Stage history or Thread messages", () => {
    expect(READING_OFFICE_TOOLS).toEqual([
      "list_projects",
      "list_people",
      READ_ROLE_TOOL,
      "list_tasks",
      "read_task",
      "list_ideas",
      "read_idea",
      "read_initiative",
      "read_attachment",
    ]);
  });

  it("gives only Devops' chat reading a repository on the workstation, never their Stage Threads", () => {
    expect(chatOfficeTools(DEVOPS)).toContain(READ_REPOSITORY_TOOL);
    expect(roleOfficeTools(DEVOPS)).not.toContain(READ_REPOSITORY_TOOL);
    expect(chatOfficeTools(PLANNER)).not.toContain(READ_REPOSITORY_TOOL);
  });

  it("gives everyone drafting a written skill as a Proposal, the Office Manager too", () => {
    expect(chatOfficeTools(PLANNER)).toContain(PROPOSE_SKILL_TOOL);
    expect(chatOfficeTools(DEVOPS)).toContain(PROPOSE_SKILL_TOOL);
    expect(chatOfficeTools(OFFICE_MANAGER)).toContain(PROPOSE_SKILL_TOOL);
  });

  it("gives Devops reading the library and drafting Project commands, test targets, Pipelines, Project Pipelines, Stage templates, Projects and skill installs and updates as Proposals", () => {
    expect(chatOfficeTools(DEVOPS)).toEqual([
      ...CHAT_OFFICE_TOOLS,
      LIST_PIPELINES_TOOL,
      PROPOSE_PROJECT_COMMANDS_TOOL,
      PROPOSE_TEST_TARGETS_TOOL,
      PROPOSE_LIBRARY_PIPELINE_TOOL,
      PROPOSE_PROJECT_PIPELINE_TOOL,
      LIST_STAGE_TEMPLATES_TOOL,
      PROPOSE_STAGE_TEMPLATE_TOOL,
      PROPOSE_PROJECT_TOOL,
      LIST_SOURCE_SKILLS_TOOL,
      PROPOSE_SKILL_INSTALL_TOOL,
      READ_SKILL_UPDATE_TOOL,
      PROPOSE_SKILL_UPDATE_TOOL,
      READ_REPOSITORY_TOOL,
      CONSULT_TOOL,
    ]);
    expect(chatOfficeTools(PLANNER)).not.toContain(PROPOSE_LIBRARY_PIPELINE_TOOL);
    expect(chatOfficeTools(PLANNER)).not.toContain(PROPOSE_PROJECT_PIPELINE_TOOL);
    expect(chatOfficeTools(PLANNER)).not.toContain(PROPOSE_STAGE_TEMPLATE_TOOL);
    expect(chatOfficeTools(PLANNER)).not.toContain(PROPOSE_SKILL_INSTALL_TOOL);
    expect(chatOfficeTools(PLANNER)).not.toContain(PROPOSE_SKILL_UPDATE_TOOL);
  });

  it("names the Proposal tools as the web does", () => {
    expect(PROPOSE_PROJECT_COMMANDS_TOOL).toBe(CONTRACT_PROPOSE_PROJECT_COMMANDS_TOOL);
    expect(PROPOSE_TEST_TARGETS_TOOL).toBe(CONTRACT_PROPOSE_TEST_TARGETS_TOOL);
    expect(PROPOSE_LIBRARY_PIPELINE_TOOL).toBe(CONTRACT_PROPOSE_LIBRARY_PIPELINE_TOOL);
    expect(PROPOSE_PROJECT_PIPELINE_TOOL).toBe(CONTRACT_PROPOSE_PROJECT_PIPELINE_TOOL);
    expect(PROPOSE_STAGE_TEMPLATE_TOOL).toBe(CONTRACT_PROPOSE_STAGE_TEMPLATE_TOOL);
    expect(PROPOSE_PROJECT_TOOL).toBe(CONTRACT_PROPOSE_PROJECT_TOOL);
    expect(PROPOSE_SKILL_INSTALL_TOOL).toBe(CONTRACT_PROPOSE_SKILL_INSTALL_TOOL);
    expect(PROPOSE_SKILL_UPDATE_TOOL).toBe(CONTRACT_PROPOSE_SKILL_UPDATE_TOOL);
    expect(PROPOSE_SKILL_TOOL).toBe(CONTRACT_PROPOSE_SKILL_TOOL);
    expect(PROPOSE_PROMPT_TEMPLATE_TOOL).toBe(CONTRACT_PROPOSE_PROMPT_TEMPLATE_TOOL);
    expect(PROPOSE_PROMPT_TEMPLATE_RESET_TOOL).toBe(CONTRACT_PROPOSE_PROMPT_TEMPLATE_RESET_TOOL);
  });

  it("gives only the Office Manager posting Link cards", () => {
    expect(chatOfficeTools(OFFICE_MANAGER)).toContain(POST_LINK_CARD_TOOL);
    expect(chatOfficeTools(PLANNER)).not.toContain(POST_LINK_CARD_TOOL);
  });

  it("gives only the Office Manager showing the Office status", () => {
    expect(chatOfficeTools(OFFICE_MANAGER)).toContain(SHOW_OFFICE_STATUS_TOOL);
    expect(chatOfficeTools(PLANNER)).not.toContain(SHOW_OFFICE_STATUS_TOOL);
  });

  it("names the tools whose calls the web shows as cards as the contracts name them", () => {
    expect(SHOW_OFFICE_STATUS_TOOL).toBe(CONTRACT_SHOW_OFFICE_STATUS_TOOL);
    expect(CHAT_OFFICE_TOOLS).toContain(CAPTURE_IDEA_TOOL);
  });
});

describe("consultationOfficeTools", () => {
  it("gives a Consultant every reading tool, and no Decision of their own", () => {
    const tools = consultationOfficeTools(CTO, true);
    expect(tools).toEqual(expect.arrayContaining([...READING_OFFICE_TOOLS]));
    expect(tools).not.toContain(OPEN_DECISION_TOOL);
  });

  it("gives a Consultant reading the Task's Stage history", () => {
    expect(consultationOfficeTools(CTO, false)).toContain(READ_STAGE_HISTORY_TOOL);
  });
});
