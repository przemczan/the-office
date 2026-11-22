import type { Decision, Thread } from "@the-office/contracts";
import {
  BUG_TASK_CREATE_OPTION,
  BUG_TASK_DONT_CREATE_OPTION,
  BUG_TASK_FIX_NOW_OPTION,
} from "@the-office/contracts";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { answerDecision } from "../../api/conversations.ts";
import {
  aDecision,
  buttonNamed,
  buttonsNamed,
  click,
  DECISION_ID,
  fieldLabelled,
  rendered,
  settle,
  TASK_THREAD,
  type,
} from "./decision-card.fixtures.tsx";
import { DecisionCard } from "./decision-card.tsx";

vi.mock("../../api/conversations.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/conversations.ts")>()),
  answerDecision: vi.fn<typeof import("../../api/conversations.ts").answerDecision>(),
}));

const BUG_TASK = aDecision({
  kind: "bug-task",
  inStageThread: true,
  context: "The token refresh runs twice.",
  bugTask: {
    title: "Two token refreshes at once sign The Office out",
    description: "**Steps to reproduce**",
    why: "The token refresh runs twice. It is outside this Task.",
    projectId: "the-office",
    causedBy: null,
  },
  questions: [
    {
      kind: "choice",
      question: "Create the Bug Task?",
      options: ["Create the Bug Task", "Don't create it", "Fix now"],
      recommendation: { option: 0, reason: "" },
    },
  ],
});

function card(decision: Decision): () => ReactNode {
  return () => (
    <DecisionCard decision={decision} personName="Kai" answering={false} followUps={false} />
  );
}

beforeEach(() => {
  vi.stubGlobal("fetch", () => Promise.resolve(Response.json([])));
  vi.mocked(answerDecision).mockReset();
  vi.mocked(answerDecision).mockResolvedValue({ id: TASK_THREAD } as Thread);
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("a bug-task Decision", () => {
  it("shows the proposal as editable fields, with four actions and no Dismiss", async () => {
    const page = await rendered(card(BUG_TASK));

    expect(page.textContent).toContain("Kai proposes a Bug Task");
    expect(page.textContent).toContain("It is outside this Task.");
    expect(page.querySelector<HTMLInputElement>("input[required]")?.value).toBe(
      "Two token refreshes at once sign The Office out",
    );
    expect(buttonsNamed("Create the Bug Task")).toHaveLength(1);
    expect(buttonsNamed("Don't create it")).toHaveLength(1);
    expect(buttonsNamed("Fix now")).toHaveLength(1);
    expect(buttonsNamed("Ask me again")).toHaveLength(1);
    expect(buttonsNamed("Dismiss")).toHaveLength(0);
  });

  it("offers no Fix now on one opened before it was offered", async () => {
    await rendered(
      card({
        ...BUG_TASK,
        questions: [
          {
            kind: "choice",
            question: "Create the Bug Task?",
            options: ["Create the Bug Task", "Don't create it"],
            recommendation: { option: 0, reason: "" },
          },
        ],
      }),
    );

    expect(buttonsNamed("Don't create it")).toHaveLength(1);
    expect(buttonsNamed("Fix now")).toHaveLength(0);
  });

  it("creates the Bug Task from the form as edited, with the general comment", async () => {
    await rendered(card(BUG_TASK));
    type(fieldLabelled("Description"), "Signed out of GitHub.");
    type(fieldLabelled("General comment"), "Normal priority is right.");

    await click(buttonNamed("Create the Bug Task"));
    await settle();

    expect(answerDecision).toHaveBeenCalledWith(DECISION_ID, {
      kind: "submitted",
      answers: [{ kind: "option", option: BUG_TASK_CREATE_OPTION }],
      bugTask: {
        title: "Two token refreshes at once sign The Office out",
        description: "Signed out of GitHub.",
        projectId: "the-office",
        causedBy: null,
      },
      generalComment: "Normal priority is right.",
    });
  });

  it("answers no with Don't create it", async () => {
    await rendered(card(BUG_TASK));

    await click(buttonNamed("Don't create it"));
    await settle();

    expect(answerDecision).toHaveBeenCalledWith(DECISION_ID, {
      kind: "submitted",
      answers: [{ kind: "option", option: BUG_TASK_DONT_CREATE_OPTION }],
    });
  });

  it("answers Fix now, sending no fields, with the general comment", async () => {
    await rendered(card(BUG_TASK));
    type(fieldLabelled("General comment"), "It's two lines.");

    await click(buttonNamed("Fix now"));
    await settle();

    expect(answerDecision).toHaveBeenCalledWith(DECISION_ID, {
      kind: "submitted",
      answers: [{ kind: "option", option: BUG_TASK_FIX_NOW_OPTION }],
      generalComment: "It's two lines.",
    });
  });

  it("says it is fixed in this Task once answered Fix now", async () => {
    const page = await rendered(
      card({
        ...BUG_TASK,
        answeredAt: "2026-11-10T14:10:00.000Z",
        formAnswer: {
          kind: "submitted",
          answers: [{ kind: "option", option: BUG_TASK_FIX_NOW_OPTION }],
        },
      }),
    );

    expect(page.textContent).toContain("Chose to fix it in this Task");
    expect(page.textContent).not.toContain("Didn't create the Bug Task");
  });

  it("asks again in a step, sending the comment alone", async () => {
    await rendered(card(BUG_TASK));

    await click(buttonNamed("Ask me again"));
    type(fieldLabelled("What should Kai explain or change?"), "Which requests?");
    await click(buttonNamed("Ask me again"));
    await settle();

    expect(answerDecision).toHaveBeenCalledWith(DECISION_ID, {
      kind: "asked-again",
      generalComment: "Which requests?",
    });
  });

  it("names the Bug Task it created once answered", async () => {
    const page = await rendered(
      card({
        ...BUG_TASK,
        answeredAt: "2026-11-10T14:10:00.000Z",
        formAnswer: {
          kind: "submitted",
          answers: [{ kind: "option", option: BUG_TASK_CREATE_OPTION }],
          bugTask: {
            title: "Two token refreshes at once",
            description: "",
            projectId: "the-office",
          },
          createdTaskId: "5e4d3c2b-1a09-4f8e-9d7c-6b5a4f3e2d1c",
        },
      }),
    );

    expect(page.textContent).toContain("Created the Bug Task");
    expect(page.textContent).toContain("Two token refreshes at once");
  });
});
