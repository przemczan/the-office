import { describe, expect, it } from "vitest";
import { CARETAKER, DEVOPS, OFFICE_MANAGER } from "../../people/index.js";
import {
  CHANGE_ROLE_TOOL,
  CONSULTATION_OFFICE_TOOLS,
  caretakerChatInstructions,
  chatInstructions,
  chatOfficeTools,
  consultationInstructions,
  PERSON_READING_OFFICE_TOOLS,
  PROPOSE_OFFICE_SETTING_TOOL,
  READ_OFFICE_INSTRUCTIONS_TOOL,
  READ_THREADS_TOOL,
  READING_OFFICE_TOOLS,
  PROPOSE_ROLE_TOOL,
  workThreadInstructions,
} from "./session-instructions.js";

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
    it("come after who the person is and before their Role's instructions and the rest", () => {
      const text = standing("Answer in plain words.");

      const places = [
        whoTheyAre,
        "## Office instructions",
        "Answer in plain words.",
        "## Your Role's instructions",
        "Write the test first.",
        theRest,
      ].map((part) => text.indexOf(part));

      expect(places).not.toContain(-1);
      expect(places).toEqual(places.toSorted((first, second) => first - second));
    });
  });
});

describe("chatOfficeTools", () => {
  it("gives the Office Manager drafting Roles and Office settings as Proposals, never changing one", () => {
    const tools = chatOfficeTools(OFFICE_MANAGER);

    expect(tools).toContain(PROPOSE_ROLE_TOOL);
    expect(tools).toContain(PROPOSE_OFFICE_SETTING_TOOL);
    expect(tools).toContain(READ_OFFICE_INSTRUCTIONS_TOOL);
    expect(tools).not.toContain(CHANGE_ROLE_TOOL);
    expect(chatOfficeTools("planner")).not.toContain(PROPOSE_ROLE_TOOL);
    expect(chatOfficeTools("planner")).not.toContain(PROPOSE_OFFICE_SETTING_TOOL);
    expect(chatOfficeTools("planner")).not.toContain(READ_OFFICE_INSTRUCTIONS_TOOL);
  });

  it("gives every chat and every Consultation reading the Threads, which no Agent Stage reads with", () => {
    for (const roleKey of ["planner", DEVOPS, CARETAKER, OFFICE_MANAGER]) {
      expect(chatOfficeTools(roleKey)).toContain(READ_THREADS_TOOL);
    }
    expect(CONSULTATION_OFFICE_TOOLS).toContain(READ_THREADS_TOOL);
    expect(PERSON_READING_OFFICE_TOOLS).toContain(READ_THREADS_TOOL);
    expect(READING_OFFICE_TOOLS).not.toContain(READ_THREADS_TOOL);
  });
});
