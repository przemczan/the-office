import {
  ANSWER_DECISION_TOOL as CONTRACT_ANSWER_DECISION_TOOL,
  CONSULT_TOOL as CONTRACT_CONSULT_TOOL,
} from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import { aDecision } from "./decision.fixtures.js";
import {
  ANSWER_DECISION_TOOL,
  CHANGE_ROLE_TOOL,
  CALLING_RULE,
  CONSULT_TOOL,
  CREATE_INITIATIVE_TOOL,
  consultationOfficeTools,
  caretakerChatInstructions,
  caretakerChatOfficeTools,
  chatInstructions,
  chatOfficeTools,
  consultationInstructions,
  decisionAnswerMessage,
  decisionAnswersOnTasksMessage,
  PERSON_READING_OFFICE_TOOLS,
  PROPOSE_OFFICE_SETTING_TOOL,
  PROPOSE_OFFICE_SETUP_TOOL,
  READ_OFFICE_INSTRUCTIONS_TOOL,
  READ_REPOSITORY_TOOL,
  READ_THREADS_TOOL,
  READING_OFFICE_TOOLS,
  PROPOSE_ROLE_TOOL,
  type HeldDuties,
  workThreadInstructions,
  WRITING_FOR_THE_USER_RULE,
} from "./session-instructions.js";
import { ANN_LEE, ANSWERED_BY_ANN_LEE } from "./user.fixtures.js";

/** The duties each default Role holds while nobody moved them; the Caretaker holds none. */
const OFFICE_MANAGER: HeldDuties = ["default-person-to-talk-to"];
const DEVOPS: HeldDuties = ["onboards-projects", "mcp-tool-consultant"];
const PLANNER: HeldDuties = ["plans"];
const CARETAKER: HeldDuties = [];

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
      standing: (officeInstructions: string) => chatInstructions({ card, officeInstructions }, []),
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
        consultationInstructions({ card, officeInstructions }, true),
      theRest: "You are in a Consultation",
    },
  ])("in $kind", ({ standing, theRest }) => {
    it("come after who the person is and before their Role's instructions and the rest", () => {
      const text = standing("Answer in plain words.");

      const places = [
        whoTheyAre,
        "## Office instructions",
        "Answer in plain words.",
        "## Your Role's instructions",
        "Write the test first.",
        WRITING_FOR_THE_USER_RULE,
        theRest,
      ].map((part) => text.indexOf(part));

      expect(places).not.toContain(-1);
      expect(places).toEqual(places.toSorted((first, second) => first - second));
    });

    it("tell the person to link the records they mention by their full ID and to fence text to copy", () => {
      expect(standing("")).toContain(WRITING_FOR_THE_USER_RULE);
      expect(WRITING_FOR_THE_USER_RULE).toContain(
        "write it as a Markdown link to its page with its full ID, never a shortened one: `[title](/tasks/<id>)`, `[name](/work/initiatives/<id>)`, `[title](/work/ideas?idea=<id>)`, `[name](/projects/<id>)`.",
      );
      expect(WRITING_FOR_THE_USER_RULE).toContain(
        "Put text the user is meant to copy, such as a message, a command or a passage you propose, in a fenced code block",
      );
    });
  });
});

describe("the Caretaker's chat instructions", () => {
  const person = {
    card: {
      name: "Cara",
      title: "Caretaker",
      responsibilities: "Looks after the workstation.",
      instructions: "Diagnose first.",
    },
    officeInstructions: "",
  };

  it("offer setting The Office up while nobody is hired, the same whether changes are allowed or not", () => {
    const reading = caretakerChatInstructions(person, false);
    const changing = caretakerChatInstructions(person, true);
    const setUp = /Setting up The Office:[^\n]*/.exec(reading)?.[0];

    expect(setUp).toContain(
      "when list_people shows nobody hired but you, offer to set The Office up",
    );
    expect(setUp).toContain("Ask what the user works on");
    expect(setUp).toContain(PROPOSE_OFFICE_SETUP_TOOL);
    expect(setUp).toContain("assign a duty only to give it to a Role other than its preset's");
    expect(changing).toContain(setUp);
  });
});

describe("chatOfficeTools", () => {
  it("gives the Office Manager drafting Roles and Office settings as Proposals, never changing one", () => {
    const tools = chatOfficeTools(OFFICE_MANAGER);

    expect(tools).toContain(PROPOSE_ROLE_TOOL);
    expect(tools).toContain(PROPOSE_OFFICE_SETTING_TOOL);
    expect(tools).toContain(READ_OFFICE_INSTRUCTIONS_TOOL);
    expect(tools).not.toContain(CHANGE_ROLE_TOOL);
    expect(chatOfficeTools(PLANNER)).not.toContain(PROPOSE_ROLE_TOOL);
    expect(chatOfficeTools(PLANNER)).not.toContain(PROPOSE_OFFICE_SETTING_TOOL);
    expect(chatOfficeTools(PLANNER)).not.toContain(READ_OFFICE_INSTRUCTIONS_TOOL);
  });

  it("gives the Caretaker drafting the set-up of The Office, and no other Proposal of a Role", () => {
    const tools = caretakerChatOfficeTools(CARETAKER);

    expect(tools).toContain(PROPOSE_OFFICE_SETUP_TOOL);
    expect(tools).toContain(CONSULT_TOOL);
    expect(tools).not.toContain(PROPOSE_ROLE_TOOL);
    expect(tools).not.toContain(PROPOSE_OFFICE_SETTING_TOOL);
    expect(tools).not.toContain(CHANGE_ROLE_TOOL);
    for (const held of [PLANNER, DEVOPS, OFFICE_MANAGER, CARETAKER]) {
      expect(chatOfficeTools(held)).not.toContain(PROPOSE_OFFICE_SETUP_TOOL);
    }
  });

  it("gives every chat and every Consultation reading the Threads, which no Agent Stage reads with", () => {
    for (const held of [PLANNER, DEVOPS, CARETAKER, OFFICE_MANAGER]) {
      expect(chatOfficeTools(held)).toContain(READ_THREADS_TOOL);
    }
    expect(consultationOfficeTools(DEVOPS, true)).toContain(READ_THREADS_TOOL);
    expect(PERSON_READING_OFFICE_TOOLS).toContain(READ_THREADS_TOOL);
    expect(READING_OFFICE_TOOLS).not.toContain(READ_THREADS_TOOL);
  });
});

describe("answer_decision", () => {
  it("is in every chat, the Caretaker's and the Office Manager's too, and in no Consultation", () => {
    for (const held of [PLANNER, DEVOPS, CARETAKER, OFFICE_MANAGER]) {
      expect(chatOfficeTools(held)).toContain(ANSWER_DECISION_TOOL);
    }
    expect(consultationOfficeTools(PLANNER, true)).not.toContain(ANSWER_DECISION_TOOL);
    expect(PERSON_READING_OFFICE_TOOLS).not.toContain(ANSWER_DECISION_TOOL);
    expect(ANSWER_DECISION_TOOL).toBe(CONTRACT_ANSWER_DECISION_TOOL);
  });
});

describe("the message an answered Decision is sent with", () => {
  const decision = aDecision();
  const option = { kind: "option", option: 1 } as const;
  const atUsersRequest = { roleKey: "cto", threadId: "chat", name: "Ada", user: ANN_LEE } as const;

  it("names who answered: the user, the Consultant, or a person at the user's request", () => {
    expect(decisionAnswerMessage(decision, option, ANSWERED_BY_ANN_LEE)).toBe(
      `The user Ann Lee answered your Decision "${decision.question}" with the option "Every Project".`,
    );
    expect(
      decisionAnswerMessage(decision, option, { kind: "consultant", roleKey: "cto", name: "Ada" }),
    ).toBe(`Ada answered your Decision "${decision.question}" with the option "Every Project".`);
    expect(
      decisionAnswerMessage(
        decision,
        { kind: "free-answer", text: "Active ones." },
        { kind: "at-users-request", ...atUsersRequest },
      ),
    ).toBe(
      `Ada answered your Decision "${decision.question}" for the user Ann Lee, at their request, in their own words:\n\nActive ones.`,
    );
  });

  it("names the person at the user's request on an Initiative's Task too", () => {
    expect(
      decisionAnswersOnTasksMessage([
        {
          decision,
          answer: option,
          taskTitle: "Export",
          answerer: { kind: "at-users-request", ...atUsersRequest },
        },
      ]),
    ).toBe(
      `On the Task "Export" (${decision.taskId}): Ada answered your Decision "${decision.question}" for the user Ann Lee, at their request, with the option "Every Project".`,
    );
  });
});

describe("calling a person", () => {
  it("is in every chat but the Office Manager's, who redirects and never relays", () => {
    for (const held of [PLANNER, DEVOPS, CARETAKER]) {
      expect(chatOfficeTools(held)).toContain(CONSULT_TOOL);
    }
    expect(chatOfficeTools(OFFICE_MANAGER)).not.toContain(CONSULT_TOOL);
    expect(CONSULT_TOOL).toBe(CONTRACT_CONSULT_TOOL);
  });

  it("is in a Consultation only while its chain of calls may ask one more", () => {
    expect(consultationOfficeTools(PLANNER, true)).toContain(CONSULT_TOOL);
    expect(consultationOfficeTools(PLANNER, false)).not.toContain(CONSULT_TOOL);
  });

  it("gives a Consultation its Consultant's own drafting tools, never the asker's", () => {
    expect(consultationOfficeTools(DEVOPS, false)).toEqual(
      expect.arrayContaining(["propose_project_commands", "read_repository", "create_task"]),
    );
    expect(consultationOfficeTools(PLANNER, false)).not.toContain("propose_project_commands");
    expect(consultationOfficeTools(DEVOPS, true)).not.toContain(CHANGE_ROLE_TOOL);
  });
});

describe("a chat's built-in tools and instructions, by the duties held", () => {
  const person = {
    card: { name: "Ada", title: "Receptionist", responsibilities: "", instructions: "" },
    officeInstructions: "",
  };

  it("give whoever holds Default person to talk to the drafting and pointing tools, and no calling", () => {
    const tools = chatOfficeTools(["default-person-to-talk-to"]);

    expect(tools).toEqual(
      expect.arrayContaining([
        PROPOSE_ROLE_TOOL,
        PROPOSE_OFFICE_SETTING_TOOL,
        READ_OFFICE_INSTRUCTIONS_TOOL,
        "post_link_card",
        "show_office_status",
        CREATE_INITIATIVE_TOOL,
      ]),
    );
    expect(tools).not.toContain("create_task");
    expect(tools).not.toContain(CONSULT_TOOL);
    expect(chatInstructions(person, ["default-person-to-talk-to"])).not.toContain(CALLING_RULE);
  });

  it("give whoever holds Onboards Projects the Project tools and reading a repository, with its rule", () => {
    const tools = chatOfficeTools(["onboards-projects"]);

    expect(tools).toEqual(
      expect.arrayContaining([
        "propose_project_commands",
        "propose_project",
        "list_pipelines",
        "propose_skill_install",
        READ_REPOSITORY_TOOL,
        CONSULT_TOOL,
        "create_task",
      ]),
    );
    expect(tools).not.toContain(PROPOSE_ROLE_TOOL);
    expect(chatInstructions(person, ["onboards-projects"])).toContain(CALLING_RULE);
    expect(chatInstructions(person, ["onboards-projects"])).not.toEqual(
      chatInstructions(person, []),
    );
  });

  it("give whoever holds Shapes Initiatives creating an Initiative, and calling", () => {
    const tools = chatOfficeTools(["shapes-initiatives", "asked-first-when-out-of-tries"]);

    expect(tools).toContain(CREATE_INITIATIVE_TOOL);
    expect(tools).toContain(CONSULT_TOOL);
    expect(tools).not.toContain("propose_project_commands");
  });

  it("give a person holding no duty the plain chat's tools and the calling rule", () => {
    const tools = chatOfficeTools([]);

    expect(tools).toContain("create_task");
    expect(tools).toContain(CONSULT_TOOL);
    for (const builtIn of [
      CREATE_INITIATIVE_TOOL,
      PROPOSE_ROLE_TOOL,
      "post_link_card",
      "propose_project_commands",
      READ_REPOSITORY_TOOL,
    ]) {
      expect(tools).not.toContain(builtIn);
    }
    expect(chatInstructions(person, [])).toContain(CALLING_RULE);
    expect(CALLING_RULE).toContain('"ask a colleague to set that up"');
  });

  it("give a Consultant their duties' drafting tools alone, whatever key their Role has", () => {
    expect(consultationOfficeTools(["onboards-projects"], false)).toContain(READ_REPOSITORY_TOOL);
    expect(consultationOfficeTools(["default-person-to-talk-to"], false)).not.toContain(
      "post_link_card",
    );
    expect(consultationOfficeTools([], false)).not.toContain("propose_project_commands");
  });
});
