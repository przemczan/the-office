import {
  ANSWER_DECISION_TOOL as CONTRACT_ANSWER_DECISION_TOOL,
  CONSULT_TOOL as CONTRACT_CONSULT_TOOL,
  OPEN_DECISION_TOOL as CONTRACT_OPEN_DECISION_TOOL,
} from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import { WRITE_RUN_ENVIRONMENT_DEFINITION_TOOL } from "../../engine/index.js";
import { oneOptionAnswer, oneWordsAnswer } from "./decision.js";
import { aDecision, THREE_QUESTIONS } from "./decision.fixtures.js";
import {
  ANSWER_DECISION_TOOL,
  CALLING_RULE,
  CHAT_DECISION_RULE,
  CONSULT_TOOL,
  OPEN_DECISION_TOOL,
  CREATE_INITIATIVE_TOOL,
  consultationOfficeTools,
  caretakerChatOfficeTools,
  chatOfficeTools,
  decisionAnswerMessage,
  decisionAnswersOnTasksMessage,
  ENGINE_TRANSCRIPTS_RULE,
  LIST_PIPELINES_TOOL,
  LIST_PROMPT_TEMPLATES_TOOL,
  LIST_STAGE_TEMPLATES_TOOL,
  OFFICE_PROPOSALS_RULE,
  PERSON_READING_OFFICE_TOOLS,
  PROPOSE_OFFICE_SETTING_TOOL,
  PROPOSE_OFFICE_SETUP_TOOL,
  READ_OFFICE_INSTRUCTIONS_TOOL,
  READ_PROMPT_TEMPLATE_TOOL,
  READ_REPOSITORY_TOOL,
  READ_ROLE_TOOL,
  READ_THREADS_TOOL,
  READING_OFFICE_TOOLS,
  personToolsRule,
  READ_REPOSITORY_RULE,
  DEFAULT_PERSON_CALLING_RULE,
  RUN_ENVIRONMENT_CHECK_TOOL,
  type HeldDuties,
  WRITING_FOR_THE_USER_RULE,
} from "./session-instructions.js";
import { ANN_LEE, ANSWERED_BY_ANN_LEE } from "./user.fixtures.js";
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
const PLANNER: HeldDuties = ["plans"];

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
        chatInstructions(PROMPTS, { card, officeInstructions }, []),
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
    const reading = caretakerChatInstructions(PROMPTS, person, false);
    const changing = caretakerChatInstructions(PROMPTS, person, true);
    const setUp = /Setting up The Office:[^\n]*/.exec(reading)?.[0];

    expect(setUp).toContain(
      "when list_people shows nobody hired but you, offer to set The Office up",
    );
    expect(setUp).toContain("Ask what the user works on");
    expect(setUp).toContain(PROPOSE_OFFICE_SETUP_TOOL);
    expect(setUp).toContain("assign a duty only to give it to a Role other than its preset's");
    expect(changing).toContain(setUp);
  });

  it.each([false, true])(
    "say where the engines' transcripts are and how to find one, with changes allowed %s",
    (changesAllowed) => {
      const text = caretakerChatInstructions(PROMPTS, person, changesAllowed);

      expect(text).toContain(ENGINE_TRANSCRIPTS_RULE);
      expect(ENGINE_TRANSCRIPTS_RULE).toContain(
        "engines/<engine id>/projects/<session folder>/<session id>.jsonl",
      );
      expect(ENGINE_TRANSCRIPTS_RULE).toContain("Search inside an engine's projects/ folder");
      expect(ENGINE_TRANSCRIPTS_RULE).toContain(
        "The OpenAI-compatible API engine's conversations aren't readable.",
      );
    },
  );

  it.each([false, true])(
    "tell it to read the current text and propose each change for the user to apply, with changes allowed %s",
    (changesAllowed) => {
      const text = caretakerChatInstructions(PROMPTS, person, changesAllowed);

      expect(text).toContain(OFFICE_PROPOSALS_RULE);
      expect(OFFICE_PROPOSALS_RULE).toContain("Read the current text right before you change it");
      expect(OFFICE_PROPOSALS_RULE).toContain(
        "never paste a new text for the user to copy in by hand",
      );
      expect(OFFICE_PROPOSALS_RULE).toContain(
        "never read a Stage's brief from a session's transcript",
      );
    },
  );
});

describe("chatOfficeTools", () => {
  it("offers every person the same candidates: the Proposal and record tools follow their Authority, none a duty", () => {
    const tools = chatOfficeTools();

    expect(tools).not.toContain("propose_role");
    expect(tools).not.toContain("change_role");
    expect(tools).toEqual(
      expect.arrayContaining([
        PROPOSE_OFFICE_SETTING_TOOL,
        READ_OFFICE_INSTRUCTIONS_TOOL,
        LIST_PROMPT_TEMPLATES_TOOL,
        READ_PROMPT_TEMPLATE_TOOL,
        READ_REPOSITORY_TOOL,
        RUN_ENVIRONMENT_CHECK_TOOL,
        CREATE_INITIATIVE_TOOL,
        "create_task",
      ]),
    );
    expect(tools).not.toContain(PROPOSE_OFFICE_SETUP_TOOL);
  });

  it("gives the Caretaker the set-up of The Office beside them, and no one else", () => {
    const tools = caretakerChatOfficeTools();

    expect(tools).toEqual(
      expect.arrayContaining([
        READ_OFFICE_INSTRUCTIONS_TOOL,
        LIST_PROMPT_TEMPLATES_TOOL,
        READ_PROMPT_TEMPLATE_TOOL,
        READ_ROLE_TOOL,
        LIST_PIPELINES_TOOL,
        LIST_STAGE_TEMPLATES_TOOL,
        PROPOSE_OFFICE_SETTING_TOOL,
        PROPOSE_OFFICE_SETUP_TOOL,
        CONSULT_TOOL,
      ]),
    );
    expect(chatOfficeTools()).not.toContain(PROPOSE_OFFICE_SETUP_TOOL);
    expect(new Set(tools).size).toBe(tools.length);
  });

  it("gives every session reading the Pipelines and Stage templates", () => {
    expect(READING_OFFICE_TOOLS).toEqual(
      expect.arrayContaining([LIST_PIPELINES_TOOL, LIST_STAGE_TEMPLATES_TOOL]),
    );
    expect(chatOfficeTools()).toEqual(
      expect.arrayContaining([LIST_PIPELINES_TOOL, LIST_STAGE_TEMPLATES_TOOL]),
    );
    expect(
      consultationOfficeTools(
        { caretaker: false },
        { canCall: false, onTask: false, runEnvironment: false },
      ),
    ).toEqual(expect.arrayContaining([LIST_PIPELINES_TOOL, LIST_STAGE_TEMPLATES_TOOL]));
  });

  it("gives every chat and every Consultation reading the Threads, which no Agent Stage reads with", () => {
    expect(chatOfficeTools()).toContain(READ_THREADS_TOOL);
    expect(
      consultationOfficeTools(
        { caretaker: false },
        { canCall: true, onTask: false, runEnvironment: false },
      ),
    ).toContain(READ_THREADS_TOOL);
    expect(PERSON_READING_OFFICE_TOOLS).toContain(READ_THREADS_TOOL);
    expect(READING_OFFICE_TOOLS).not.toContain(READ_THREADS_TOOL);
  });
});

describe("answer_decision", () => {
  it("is in every chat, the Caretaker's and the Office Manager's too, and in no Consultation", () => {
    expect(chatOfficeTools()).toContain(ANSWER_DECISION_TOOL);
    expect(caretakerChatOfficeTools()).toContain(ANSWER_DECISION_TOOL);
    expect(
      consultationOfficeTools(
        { caretaker: false },
        { canCall: true, onTask: false, runEnvironment: false },
      ),
    ).not.toContain(ANSWER_DECISION_TOOL);
    expect(PERSON_READING_OFFICE_TOOLS).not.toContain(ANSWER_DECISION_TOOL);
    expect(ANSWER_DECISION_TOOL).toBe(CONTRACT_ANSWER_DECISION_TOOL);
  });
});

describe("open_decision in a chat", () => {
  it("is in every chat, the Caretaker's and the Office Manager's too, and in no Consultation", () => {
    expect(chatOfficeTools()).toContain(OPEN_DECISION_TOOL);
    expect(caretakerChatOfficeTools()).toContain(OPEN_DECISION_TOOL);
    expect(
      consultationOfficeTools(
        { caretaker: false },
        { canCall: true, onTask: false, runEnvironment: false },
      ),
    ).not.toContain(OPEN_DECISION_TOOL);
    expect(OPEN_DECISION_TOOL).toBe(CONTRACT_OPEN_DECISION_TOOL);
  });

  it("comes with the rule to ask everything in one form, right after the calling rule", () => {
    const card = { name: "Ada", title: "Developer", responsibilities: "", instructions: "" };
    const person = { card, officeInstructions: "" };

    for (const instructions of [
      chatInstructions(PROMPTS, person, PLANNER),
      chatInstructions(PROMPTS, person, OFFICE_MANAGER),
      caretakerChatInstructions(PROMPTS, person, false),
    ]) {
      expect(instructions).toContain(`${CALLING_RULE}\n\n${CHAT_DECISION_RULE}`);
    }
    expect(consultationInstructions(PROMPTS, person, true)).not.toContain(CHAT_DECISION_RULE);
  });
});

describe("the message an answered Decision is sent with", () => {
  const decision = aDecision();
  const option = oneOptionAnswer(1);
  const atUsersRequest = { roleKey: "cto", threadId: "chat", name: "Ada", user: ANN_LEE } as const;
  const answered = "1. Should the export include archived Projects?\n   Answer: Every Project";

  it("names who answered: the user, the Consultant, or a person at the user's request", () => {
    expect(decisionAnswerMessage(decision, option, ANSWERED_BY_ANN_LEE)).toBe(
      `The user Ann Lee answered your Decision:\n\n${answered}`,
    );
    expect(
      decisionAnswerMessage(decision, option, { kind: "consultant", roleKey: "cto", name: "Ada" }),
    ).toBe(`Ada answered your Decision:\n\n${answered}`);
    expect(
      decisionAnswerMessage(decision, oneWordsAnswer("Active ones."), {
        kind: "at-users-request",
        ...atUsersRequest,
      }),
    ).toBe(
      "Ada answered your Decision for the user Ann Lee, at their request:\n\n1. Should the export include archived Projects?\n   Answer, in their own words: Active ones.",
    );
    expect(
      decisionAnswerMessage(
        decision,
        { kind: "asked-again", generalComment: "Say what archived means." },
        { kind: "at-users-request", ...atUsersRequest },
      ),
    ).toBe(
      "Ada asked you to ask again for the user Ann Lee, at their request, answering none of your Decision's questions:\n\nGeneral comment: Say what archived means.\n\nAnswer what they said, then open a new Decision for what you still need to ask.",
    );
  });

  it("gives every question with its answer and comment, and the general comment", () => {
    const form = aDecision({ questions: THREE_QUESTIONS });
    expect(
      decisionAnswerMessage(
        form,
        {
          kind: "submitted",
          answers: [
            { kind: "option", option: 0 },
            { kind: "words", text: "2026", comment: "Only this year." },
            { kind: "option", option: 1, comment: "For the API." },
          ],
          generalComment: "Ship it Friday.",
        },
        ANSWERED_BY_ANN_LEE,
      ),
    ).toBe(
      [
        "The user Ann Lee answered your Decision:",
        "",
        "1. Should the export include archived Projects?",
        "   Answer: Only active Projects",
        "2. Which years should it cover?",
        "   Answer, in their own words: 2026",
        "   Comment: Only this year.",
        "3. Which format?",
        "   Answer: JSON",
        "   Comment: For the API.",
        "",
        "General comment: Ship it Friday.",
      ].join("\n"),
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
      `On the Task "Export" (${decision.taskId}): Ada answered your Decision for the user Ann Lee, at their request:\n\n${answered}`,
    );
  });
});

describe("calling a person", () => {
  it("is in every chat, the Office Manager's too, who calls only when the user asks", () => {
    expect(chatOfficeTools()).toContain(CONSULT_TOOL);
    expect(CONSULT_TOOL).toBe(CONTRACT_CONSULT_TOOL);
  });

  it("is in a Consultation only while its chain of calls may ask one more", () => {
    expect(
      consultationOfficeTools(
        { caretaker: false },
        { canCall: true, onTask: false, runEnvironment: false },
      ),
    ).toContain(CONSULT_TOOL);
    expect(
      consultationOfficeTools(
        { caretaker: false },
        { canCall: false, onTask: false, runEnvironment: false },
      ),
    ).not.toContain(CONSULT_TOOL);
  });

  it("gives a Consultation on a Task writing the run environment definition only with the Run environment capability, never off a Task or in a chat", () => {
    expect(
      consultationOfficeTools(
        { caretaker: false },
        { canCall: false, onTask: true, runEnvironment: true },
      ),
    ).toContain(WRITE_RUN_ENVIRONMENT_DEFINITION_TOOL);
    expect(
      consultationOfficeTools(
        { caretaker: false },
        { canCall: false, onTask: true, runEnvironment: false },
      ),
    ).not.toContain(WRITE_RUN_ENVIRONMENT_DEFINITION_TOOL);
    expect(
      consultationOfficeTools(
        { caretaker: false },
        { canCall: true, onTask: false, runEnvironment: true },
      ),
    ).not.toContain(WRITE_RUN_ENVIRONMENT_DEFINITION_TOOL);
    expect(chatOfficeTools()).not.toContain(WRITE_RUN_ENVIRONMENT_DEFINITION_TOOL);
    expect(caretakerChatOfficeTools()).not.toContain(WRITE_RUN_ENVIRONMENT_DEFINITION_TOOL);
  });

  it("offers run_environment_check as a candidate in a chat and a Consultation, on a Task or not, its Run installs setting deciding it", () => {
    expect(RUN_ENVIRONMENT_CHECK_TOOL).toBe("run_environment_check");
    expect(chatOfficeTools()).toContain(RUN_ENVIRONMENT_CHECK_TOOL);
    for (const onTask of [false, true]) {
      expect(
        consultationOfficeTools(
          { caretaker: false },
          { canCall: false, onTask, runEnvironment: false },
        ),
      ).toContain(RUN_ENVIRONMENT_CHECK_TOOL);
    }
  });

  it("gives a Consultation its Consultant's own tools, drafting among them, never the asker's", () => {
    const tools = consultationOfficeTools(
      { caretaker: false },
      { canCall: false, onTask: false, runEnvironment: false },
    );

    expect(tools).toEqual(
      expect.arrayContaining(["propose_project", "read_repository", "create_task"]),
    );
    expect(tools).not.toContain("change_role");
    expect(tools).not.toContain(PROPOSE_OFFICE_SETUP_TOOL);
  });
});

describe("a chat's instructions, by the duties held, and its tools, by none", () => {
  const person = {
    card: { name: "Ada", title: "Receptionist", responsibilities: "", instructions: "" },
    officeInstructions: "",
  };

  it("tell whoever holds Default person to talk to to point with a Link card and call only when the user asks", () => {
    const instructions = chatInstructions(PROMPTS, person, ["default-person-to-talk-to"]);

    expect(instructions).toContain(CALLING_RULE);
    expect(instructions).toContain(
      "You point the user to whoever is responsible with a Link card rather than relay their work",
    );
    expect(chatInstructions(PROMPTS, person, [])).not.toContain("rather than relay");
  });

  it("tell whoever holds Onboards Projects to set a Project up with their tools", () => {
    expect(chatInstructions(PROMPTS, person, ["onboards-projects"])).toContain(CALLING_RULE);
    expect(chatInstructions(PROMPTS, person, ["onboards-projects"])).not.toEqual(
      chatInstructions(PROMPTS, person, []),
    );
  });

  it("give a person holding no duty the calling rule", () => {
    expect(chatInstructions(PROMPTS, person, [])).toContain(CALLING_RULE);
    expect(CALLING_RULE).toContain('"ask a colleague to set that up"');
  });

  it("offer the same candidate tools to every person, whatever duties they hold, in a chat and a Consultation", () => {
    const consultation = consultationOfficeTools(
      { caretaker: false },
      { canCall: false, onTask: false, runEnvironment: false },
    );

    for (const tool of [
      "post_link_card",
      "show_office_status",
      READ_REPOSITORY_TOOL,
      CREATE_INITIATIVE_TOOL,
      "propose_project",
    ]) {
      expect(chatOfficeTools()).toContain(tool);
      expect(consultation).toContain(tool);
    }
  });
});

describe("personToolsRule", () => {
  const OFFERED = ["create_task", "propose_project", "capture_idea"];

  it("says a person creates a Task only while create_task is offered, whatever duty they hold", () => {
    const creating = personToolsRule(
      { offered: OFFERED, defaultPerson: false, caretaker: false },
      "task",
    );
    const pointing = personToolsRule(
      { offered: ["capture_idea"], defaultPerson: true, caretaker: false },
      "task",
    );

    expect(creating).toContain("create a Task in Backlog");
    expect(pointing).not.toContain("create a Task in Backlog");
    expect(pointing).toContain(DEFAULT_PERSON_CALLING_RULE);
    expect(creating).not.toContain(DEFAULT_PERSON_CALLING_RULE);
  });

  it("adds how to read a repository only to a person offered propose_project, not to one who holds Onboards Projects with it Never", () => {
    const offered = personToolsRule(
      { offered: OFFERED, defaultPerson: false, caretaker: false },
      "initiative",
    );
    const never = personToolsRule(
      { offered: ["create_task"], defaultPerson: false, caretaker: false },
      "initiative",
    );

    expect(offered).toContain(READ_REPOSITORY_RULE);
    expect(never).not.toContain(READ_REPOSITORY_RULE);
  });

  it("adds how the Caretaker changes how The Office works to the Caretaker alone", () => {
    expect(
      personToolsRule({ offered: OFFERED, defaultPerson: false, caretaker: true }, "task"),
    ).toContain(OFFICE_PROPOSALS_RULE);
    expect(
      personToolsRule({ offered: OFFERED, defaultPerson: false, caretaker: false }, "task"),
    ).not.toContain(OFFICE_PROPOSALS_RULE);
  });
});
