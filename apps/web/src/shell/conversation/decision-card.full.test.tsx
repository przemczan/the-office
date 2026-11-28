import type { Decision, Thread } from "@the-office/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api/api-client.ts";
import { answerDecision, threadQueries } from "../../api/conversations.ts";
import { roleQueries } from "../../api/people.ts";
import { ToastProvider } from "../toasts.tsx";
import { BY_ANN, BY_YOU } from "../user.fixtures.ts";
import {
  aDecision,
  buttonNamed,
  buttonsNamed,
  CHAT_THREAD,
  checkbox,
  click,
  COLUMNS,
  CONSULTATION_ON_TASK,
  DECISION_ID,
  fieldLabelled,
  fieldsLabelled,
  FILE_NAME,
  FORMAT,
  PLANNER,
  PLANNING_THREAD,
  radio,
  rendered,
  REVIEWER,
  settle,
  STORES,
  TASK,
  TASK_THREAD,
  type,
} from "./decision-card.fixtures.tsx";
import { DecisionCard, DecisionInThread, type DecisionCardProps } from "./decision-card.tsx";
import { DecisionDraftsProvider } from "./decision-drafts.tsx";

vi.mock("../../api/conversations.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/conversations.ts")>()),
  answerDecision: vi.fn<typeof import("../../api/conversations.ts").answerDecision>(),
}));

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const MIXED = aDecision({
  context: "Usage is exported **once a month**.\nThe finance team reads it.",
  questions: [FORMAT, FILE_NAME, COLUMNS],
});

function card(decision: Decision, props: Partial<DecisionCardProps> = {}): () => ReactNode {
  return () => (
    <DecisionCard decision={decision} personName="Angela" answering={false} followUps {...props} />
  );
}

function inThread(decision: Decision, answering = false): () => ReactNode {
  return () => <DecisionInThread decision={decision} personName="Angela" answering={answering} />;
}

const SENT = { id: TASK_THREAD } as Thread;

beforeEach(() => {
  vi.mocked(answerDecision).mockReset();
  vi.mocked(answerDecision).mockResolvedValue(SENT);
});
afterEach(() => document.body.replaceChildren());

describe("a form of several questions, in place", () => {
  it("numbers each question, a choice with its options and recommendation, an open one a box", async () => {
    const page = await rendered(card(MIXED));

    expect(page.querySelector("section")?.getAttribute("aria-label")).toBe(
      "Decision: Which format? (and 2 more questions)",
    );
    expect(page.querySelector(".decision-count")?.textContent).toBe("· 3 questions");
    expect(page.querySelector(".decision-context")?.textContent).toContain("once a month");
    const numbers = [...page.querySelectorAll(".decision-form-number")].map((number) => [
      number.firstChild?.textContent,
      number.classList.contains("answered"),
    ]);
    expect(numbers).toEqual([
      ["1", true],
      ["2", false],
      ["3", true],
    ]);
    expect(radio("Which format?", "CSV").checked).toBe(true);
    expect(radio("Which columns?", "Only totals").checked).toBe(true);
    const formatLines = [
      ...(page
        .querySelector("[role='radiogroup'][aria-label='Which format?']")
        ?.querySelectorAll("label") ?? []),
    ].map((line) => line.textContent);
    expect(formatLines).toEqual(["CSVRecommended", "JSON", "None of these: answer in words"]);
    expect(page.textContent).toContain("Angela recommends “CSV”: Spreadsheets open it.");
    expect(fieldsLabelled("Your answer")).toHaveLength(1);
    expect(fieldLabelled("General comment").value).toBe("");
    expect(page.querySelector(".decision-progress")?.textContent).toContain("2 of 3 answered");
  });

  it("keeps Submit disabled until every question has an answer, naming the one missing", async () => {
    const page = await rendered(card(MIXED));

    const submit = buttonNamed("Submit");
    expect(submit.disabled).toBe(true);
    expect(submit.title).toBe("Answer question 2 first.");
    await click(buttonNamed("Question 2 needs an answer"));
    expect(document.activeElement).toBe(fieldLabelled("Your answer"));

    type(fieldLabelled("Your answer"), "usage.csv");
    expect(buttonNamed("Submit").disabled).toBe(false);
    expect(page.querySelector(".decision-progress")?.textContent).toContain("Ready to submit");

    await click(radio("Which columns?", "None of these"));
    expect(buttonNamed("Submit").title).toBe("Answer question 3 in its words first.");
    type(fieldLabelled("Your answer in words"), "Totals and the date");
    expect(buttonNamed("Submit").disabled).toBe(false);
  });

  it("sends each answer with its comment, a choice in words, and the general comment", async () => {
    await rendered(card(MIXED));

    await click(radio("Which format?", "JSON"));
    const [addFirst] = buttonsNamed("Add a comment");
    await click(addFirst!);
    type(fieldLabelled("Comment"), "Our scripts read JSON.");
    type(fieldLabelled("Your answer"), "usage.json");
    await click(radio("Which columns?", "None of these"));
    type(fieldLabelled("Your answer in words"), "Totals and the date");
    type(fieldLabelled("General comment"), "Thanks!");
    await click(buttonNamed("Submit"));
    await settle();

    expect(answerDecision).toHaveBeenCalledWith(DECISION_ID, {
      kind: "submitted",
      answers: [
        { kind: "option", option: 1, comment: "Our scripts read JSON." },
        { kind: "words", text: "usage.json" },
        { kind: "words", text: "Totals and the date" },
      ],
      generalComment: "Thanks!",
    });
  });

  it("keeps a written comment open", async () => {
    await rendered(card(aDecision()));

    expect(fieldsLabelled("Comment")).toHaveLength(0);
    await click(buttonNamed("Add a comment"));
    type(fieldLabelled("Comment"), "Only this once");
    await click(radio("Which format?", "JSON"));
    expect(fieldLabelled("Comment").value).toBe("Only this once");
    expect(buttonsNamed("Add a comment")).toHaveLength(0);
  });

  it("asks what to explain or change before Ask me again, sending only the general comment", async () => {
    const page = await rendered(card(MIXED));

    await click(radio("Which format?", "JSON"));
    await click(buttonNamed("Ask me again"));
    expect(answerDecision).not.toHaveBeenCalled();
    const step = page.querySelector<HTMLElement>("section[aria-label='Ask me again']");
    expect(step?.textContent).toContain("Your picks stay here as a draft until you send");
    expect(buttonsNamed("Submit")).toHaveLength(0);
    type(fieldLabelled("What should Angela explain or change?"), "Why not Parquet?");
    await click(buttonNamed("Ask me again", step!));
    await settle();

    expect(answerDecision).toHaveBeenCalledWith(DECISION_ID, {
      kind: "asked-again",
      generalComment: "Why not Parquet?",
    });
  });

  it("lets Cancel leave the step with the picks as they were", async () => {
    await rendered(card(MIXED));

    await click(radio("Which format?", "JSON"));
    await click(buttonNamed("Ask me again"));
    await click(buttonNamed("Cancel"));
    expect(radio("Which format?", "JSON").checked).toBe(true);
    expect(buttonsNamed("Submit")).toHaveLength(1);
  });

  it("offers no Ask me again on The Office's own Decision", async () => {
    await rendered(card(aDecision({ roleKey: null })));

    expect(buttonsNamed("Ask me again")).toHaveLength(0);
    expect(buttonsNamed("Submit")).toHaveLength(1);
    expect(document.body.textContent).toContain("The Office recommends “CSV”");
  });
});

describe("while the person answers", () => {
  it("waits, saying why", async () => {
    const page = await rendered(card(aDecision(), { answering: true }));

    expect(buttonNamed("Submit").disabled).toBe(true);
    expect(buttonNamed("Submit").title).toBe("Angela is still answering. Answer once they finish.");
    expect(buttonNamed("Ask me again").disabled).toBe(true);
    expect(buttonNamed("Ask me again").title).toBe(
      "Angela is still answering. Ask again once they finish.",
    );
    expect(page.textContent).toContain("Angela is still answering. Answer once they finish.");
  });

  it("is answered at once in a planning Thread, reaching them when the turn ends", async () => {
    const page = await rendered(
      card(aDecision({ threadId: PLANNING_THREAD }), { reachesAtTurnEnd: true }),
    );

    expect(buttonNamed("Submit").disabled).toBe(false);
    expect(buttonNamed("Ask me again").disabled).toBe(false);
    expect(page.textContent).toContain("Reaches Angela when this turn ends.");
    expect(page.textContent).not.toContain("is still answering");
  });
});

describe("a refused answer", () => {
  it("says why and keeps the draft", async () => {
    vi.mocked(answerDecision).mockRejectedValue(
      new ApiError(409, "This Decision is answered already."),
    );
    const page = await rendered(card(aDecision()));

    await click(radio("Which format?", "JSON"));
    type(fieldLabelled("General comment"), "Thanks");
    await click(buttonNamed("Submit"));
    await settle();

    expect(page.textContent).toContain("The answer wasn't sent");
    expect(page.textContent).toContain("This Decision is answered already.");
    expect(radio("Which format?", "JSON").checked).toBe(true);
    expect(fieldLabelled("General comment").value).toBe("Thanks");
  });
});

describe("a request", () => {
  it("reads as what was asked and why, answered in words", async () => {
    const page = await rendered(
      card(
        aDecision({
          kind: "request",
          questions: [{ kind: "open", question: "Add the API key.", why: "Only you have it." }],
        }),
      ),
    );

    expect(page.querySelector(".decision-question")?.textContent).toBe(
      "Asked you to: Add the API key.",
    );
    expect(page.textContent).toContain("Why Angela needs it: Only you have it.");
    expect(buttonNamed("Submit").title).toBe("Write your answer first.");
    type(fieldLabelled("Your answer"), "Added it.");
    await click(buttonNamed("Submit"));
    await settle();
    expect(answerDecision).toHaveBeenCalledWith(DECISION_ID, {
      kind: "submitted",
      answers: [{ kind: "words", text: "Added it." }],
    });
  });
});

describe("an approval", () => {
  const approval = aDecision({
    kind: "approval",
    questions: [
      {
        kind: "choice",
        question: "Install ffmpeg on the machine",
        options: ["Allow once", "Deny"],
        recommendation: { option: 0, reason: "The thumbnails need it." },
      },
    ],
  });

  it("is sent in one click per option, with no comment and no Ask me again", async () => {
    await rendered(card(approval));

    expect(buttonsNamed("Ask me again")).toHaveLength(0);
    expect(buttonsNamed("Add a comment")).toHaveLength(0);
    expect(buttonsNamed("Submit")).toHaveLength(0);
    await click(buttonNamed("Deny"));
    await settle();

    expect(answerDecision).toHaveBeenCalledWith(DECISION_ID, {
      kind: "submitted",
      answers: [{ kind: "option", option: 1 }],
    });
  });

  it("shows no held call's words when it has none", async () => {
    const root = await rendered(card(approval));

    expect(root.querySelector(".held-call")).toBeNull();
    expect(root.textContent).toContain("Install ffmpeg on the machine");
  });
});

describe("an approval of a held call", () => {
  const heldApproval = aDecision({
    kind: "approval",
    questions: [
      {
        kind: "choice",
        question: "Allow Jan to Start a Task?",
        options: ["Allow once", "Deny"],
        recommendation: { option: 0, reason: "Start a Task needs approval for each call." },
      },
    ],
    heldCall: {
      action: "Start a Task",
      description: "Starts the Task's Pipeline.",
      subject: { kind: "task", id: TASK.id, title: TASK.title },
      input: { taskId: TASK.id, note: "Go ahead.", token: "" },
      callAsSent: { action: "start_task", input: { taskId: TASK.id, note: "Go ahead." } },
    },
  });

  it("shows the action, its description, the record and the input in words, no raw JSON", async () => {
    const root = await rendered(card(heldApproval));
    const held = root.querySelector(".held-call");

    expect(root.textContent).toContain("Allow Jan to Start a Task?");
    expect(held?.querySelector(".held-call-action")?.textContent).toBe("Start a Task");
    expect(held?.textContent).toContain("Starts the Task's Pipeline.");
    expect(held?.querySelector("a.proposal-link")?.textContent).toBe(TASK.title);
    const labels = [...root.querySelectorAll(".held-call-input .proposal-change-label")];
    expect(labels.map((label) => label.textContent)).toEqual(["Task", "Note"]);
    expect(held?.querySelector(".held-call-input")?.textContent).not.toContain('"taskId"');
  });

  it("keeps the call as sent behind a collapsed disclosure", async () => {
    const root = await rendered(card(heldApproval));
    const raw = root.querySelector<HTMLDetailsElement>("details.held-call-raw");

    expect(raw?.open).toBe(false);
    expect(raw?.querySelector("summary")?.textContent).toContain("Show the call as sent");
    expect(raw?.querySelector("pre")?.textContent).toContain('"action": "start_task"');
    expect(raw?.querySelector("pre")?.textContent).toContain('"taskId"');
  });

  it("still answers in one click", async () => {
    await rendered(card(heldApproval));

    await click(buttonNamed("Allow once"));
    await settle();

    expect(answerDecision).toHaveBeenCalledWith(DECISION_ID, {
      kind: "submitted",
      answers: [{ kind: "option", option: 0 }],
    });
  });
});

describe("a Decision put to a Consultant", () => {
  it("keeps the form locked until the user takes it over, which sends nothing", async () => {
    const page = await rendered(card(aDecision({ questions: [FORMAT], putTo: "reviewer" })));

    expect(page.querySelector(".decision-consultation")?.textContent).toContain(
      "Waiting on Michael in a Consultation. Take it over to answer here.",
    );
    expect(buttonNamed("Submit").disabled).toBe(true);
    expect(buttonNamed("Submit").title).toBe("Take it over first.");
    expect(buttonNamed("Ask me again").disabled).toBe(true);
    expect(radio("Which format?", "JSON").disabled).toBe(true);
    expect(fieldLabelled("General comment").disabled).toBe(true);

    await click(buttonNamed("Take it over"));
    expect(answerDecision).not.toHaveBeenCalled();
    expect(buttonsNamed("Take it over")).toHaveLength(0);
    expect(page.querySelector(".decision-consultation")?.textContent).toContain(
      "Your answer here takes it over.",
    );
    expect(buttonNamed("Submit").disabled).toBe(false);
    await click(radio("Which format?", "JSON"));
    await click(buttonNamed("Submit"));
    await settle();

    expect(answerDecision).toHaveBeenCalledWith(DECISION_ID, {
      kind: "submitted",
      answers: [{ kind: "option", option: 1 }],
    });
  });

  it("keeps an approval's options locked until taken over", async () => {
    const approval = aDecision({
      kind: "approval",
      putTo: "reviewer",
      questions: [
        {
          kind: "choice",
          question: "Install ffmpeg on the machine",
          options: ["Allow once", "Deny"],
          recommendation: { option: 0, reason: "The thumbnails need it." },
        },
      ],
    });
    await rendered(card(approval));

    expect(buttonNamed("Allow once").disabled).toBe(true);
    expect(buttonNamed("Deny").title).toBe("Take it over first.");
    await click(buttonNamed("Take it over"));
    expect(buttonNamed("Deny").disabled).toBe(false);
  });
});

describe("a card inline in a chat", () => {
  it("is the whole form in place, however long", async () => {
    await rendered(
      card(aDecision({ questions: [FORMAT, FILE_NAME, COLUMNS, FORMAT] }), { where: "inline" }),
    );

    expect(buttonsNamed("Open details")).toHaveLength(0);
    expect(buttonsNamed("Submit")).toHaveLength(1);
    expect(document.body.textContent).toContain("A question first? Ask Angela below");
  });
});

describe("a Decision in its Thread", () => {
  it("names its Task in an Initiative's planning Thread, leading to its card there", async () => {
    const page = await rendered(inThread(aDecision({ threadId: PLANNING_THREAD })));

    const onTask = page.querySelector(".decision-on-task");
    expect(onTask?.textContent).toBe(`On ${TASK.title}`);
    expect(onTask?.querySelector("a")?.getAttribute("href")).toBe(`/tasks/${TASK.id}`);
    const toCard = [...page.querySelectorAll("a")].find(
      (link) => link.textContent === "Answer it in Needs you",
    );
    expect(toCard?.getAttribute("href")).toBe(`/tasks/${TASK.id}?decision=${DECISION_ID}`);
  });

  it("names no Task in a Thread on the Task", async () => {
    const page = await rendered(inThread(aDecision()));

    expect(page.querySelector(".decision-on-task")).toBeNull();
  });

  it("stays short while open: how many questions, starting with the first", async () => {
    const page = await rendered(inThread(MIXED));

    expect(page.querySelector(".decision-question")?.textContent).toBe(
      "3 questions, starting with: Which format?",
    );
    expect(page.querySelectorAll("[role='radiogroup']")).toHaveLength(0);
    expect(page.querySelector(".decision-card")?.classList.contains("settled")).toBe(false);
  });
});

function header(page: HTMLElement): HTMLElement {
  const line = page.querySelector<HTMLElement>(".message-by");
  if (line === null) throw new Error("The Decision has no header.");
  return line;
}

/** The header's words past its badge, leaving out the avatars' initials. */
function headerWords(page: HTMLElement): string {
  return [...header(page).querySelectorAll(".person-tag-name, .decision-put-to")]
    .map((part) => part.textContent)
    .join(" ");
}

describe("a Decision's header", () => {
  it("names the Consultant it was put to, linking to their page", async () => {
    const page = await rendered(inThread(aDecision({ putTo: "reviewer" })));

    expect(headerWords(page)).toBe("Angela to Michael");
    expect(
      [...header(page).querySelectorAll("a.person-tag")].map((tag) => tag.getAttribute("href")),
    ).toEqual(["/people/planner", "/people/reviewer"]);
  });

  it("keeps whom it was put to once answered", async () => {
    const page = await rendered(
      inThread(
        aDecision({
          putTo: "reviewer",
          formAnswer: { kind: "submitted", answers: [{ kind: "option", option: 0 }] },
          answeredAt: "2026-11-10T14:30:00.000Z",
          answeredBy: "reviewer",
        }),
      ),
    );

    expect(headerWords(page)).toBe("Angela to Michael");
  });

  it("links to the Consultation on the Task, beside taking it over", async () => {
    const page = await rendered(inThread(aDecision({ putTo: "reviewer" })));

    const links = [...page.querySelectorAll(".decision-hint a")].map((link) => [
      link.textContent,
      link.getAttribute("href"),
    ]);
    expect(links).toEqual([
      [
        "Take it over in Needs you",
        `/tasks/${TASK.id}?taskThread=${TASK_THREAD}&decision=${DECISION_ID}`,
      ],
      ["Open the Consultation", `/tasks/${TASK.id}?taskThread=${CONSULTATION_ON_TASK}`],
    ]);
  });

  it("names the Role key when the Consultant's Role is gone", async () => {
    const page = await rendered(inThread(aDecision({ putTo: "designer" })));

    expect(headerWords(page)).toBe("Angela to designer");
  });

  it("names no one else when it waits on the user", async () => {
    const page = await rendered(inThread(aDecision()));

    expect(headerWords(page)).toBe("Angela");
    expect(header(page).querySelector(".decision-put-to")).toBeNull();
  });
});

/** The form answered, as `fields` say who gave it. */
function answered(fields: Partial<Decision> = {}): Decision {
  return aDecision({
    questions: [FORMAT, FILE_NAME, COLUMNS],
    formAnswer: {
      kind: "submitted",
      answers: [
        { kind: "option", option: 0, comment: "Spreadsheets win." },
        { kind: "words", text: "usage.csv" },
        { kind: "words", text: "Totals and the date" },
      ],
      generalComment: "Thanks!",
    },
    answeredAt: "2026-11-10T14:30:00.000Z",
    ...fields,
  });
}

function outcome(page: HTMLElement): HTMLElement {
  const line = page.querySelector<HTMLElement>(".decision-answered");
  if (line === null) throw new Error("The Decision shows no outcome.");
  return line;
}

/** A two-question Decision the user dismissed. */
function dismissed(fields: Partial<Decision>): Decision {
  return aDecision({
    questions: [FORMAT, FILE_NAME],
    formAnswer: { kind: "dismissed" },
    answeredAt: "2026-11-10T14:30:00.000Z",
    answeredByUser: BY_YOU,
    ...fields,
  });
}

describe("an answered Decision", () => {
  it("shows each question with its answer, its comment, and the general comment, without the amber", async () => {
    const page = await rendered(inThread(answered({ answeredByUser: BY_YOU })));

    expect(page.querySelector(".decision-card")?.classList.contains("settled")).toBe(true);
    const answers = [...page.querySelectorAll(".decision-answer")].map((item) => [
      item.querySelector(".decision-answer-question")?.textContent,
      item.querySelector(".decision-answer-words")?.textContent,
      item.querySelector(".decision-answer-comment")?.textContent ?? null,
    ]);
    expect(answers).toEqual([
      ["Which format?", "CSV (recommended)", "Comment: Spreadsheets win."],
      ["What is the file called?", "usage.csv", null],
      ["Which columns?", "Totals and the date", null],
    ]);
    expect(page.querySelector(".decision-general-comment")?.textContent).toBe(
      "General comment: Thanks!",
    );
    expect(outcome(page).textContent).toBe("Answered by you");
  });

  it("shows the first 3 questions of a longer form, and all of them on Show all", async () => {
    const page = await rendered(
      inThread(
        answered({
          questions: [FORMAT, FILE_NAME, COLUMNS, FORMAT],
          formAnswer: {
            kind: "submitted",
            answers: [
              { kind: "option", option: 0 },
              { kind: "words", text: "usage.csv" },
              { kind: "option", option: 1 },
              { kind: "option", option: 1 },
            ],
          },
        }),
      ),
    );

    expect(page.querySelectorAll(".decision-answer")).toHaveLength(3);
    await click(buttonNamed("Show all 4"));
    expect(page.querySelectorAll(".decision-answer")).toHaveLength(4);
    expect(buttonsNamed("Show all 4")).toHaveLength(0);
  });

  it("names another user by name", async () => {
    const page = await rendered(inThread(answered({ answeredByUser: BY_ANN })));

    expect(outcome(page).textContent).toBe("Answered by Ann Lee");
  });

  it("names the Consultant who answered in a Consultation, with the way to it", async () => {
    const page = await rendered(inThread(answered({ putTo: "reviewer", answeredBy: "reviewer" })));

    expect(outcome(page).textContent).toBe(
      "Answered by Michael in a Consultation · Open the Consultation",
    );
    expect(outcome(page).querySelector("a")?.getAttribute("href")).toBe(
      `/tasks/${TASK.id}?taskThread=${CONSULTATION_ON_TASK}`,
    );
  });

  it("names the person who answered at the user's request, linking to the chat they were asked in", async () => {
    const page = await rendered(
      inThread(
        answered({ atUsersRequest: { roleKey: "reviewer", threadId: CHAT_THREAD, user: null } }),
      ),
    );

    const line = outcome(page);
    expect(line.textContent).toBe("Answered by Michael at your request");
    expect(line.querySelector("a")?.getAttribute("href")).toBe(
      `/?chat=reviewer&thread=${CHAT_THREAD}`,
    );
    document.body.replaceChildren();

    const atAnns = await rendered(
      inThread(
        answered({ atUsersRequest: { roleKey: "reviewer", threadId: CHAT_THREAD, user: BY_ANN } }),
      ),
    );
    expect(outcome(atAnns).textContent).toBe("Answered by Michael at Ann Lee's request");
  });

  it("shows the questions unanswered once asked again, with the general comment", async () => {
    const page = await rendered(
      inThread(
        aDecision({
          questions: [FORMAT, FILE_NAME],
          formAnswer: { kind: "asked-again", generalComment: "Why not Parquet?" },
          answeredAt: "2026-11-10T14:30:00.000Z",
          answeredByUser: BY_YOU,
        }),
      ),
    );

    expect(
      [...page.querySelectorAll(".decision-answer-words")].map(({ textContent }) => textContent),
    ).toEqual(["Not answered", "Not answered"]);
    expect(outcome(page).textContent).toBe("Asked again by you: Why not Parquet?");
  });

  it("shows the questions unanswered once dismissed, with who dismissed it and why", async () => {
    const page = await rendered(inThread(dismissed({})));

    expect(
      [...page.querySelectorAll(".decision-answer-words")].map(({ textContent }) => textContent),
    ).toEqual(["Not answered", "Not answered"]);
    expect(outcome(page).textContent).toBe("Dismissed by you");
    document.body.replaceChildren();

    const byAnn = await rendered(
      card(
        dismissed({
          formAnswer: { kind: "dismissed", generalComment: "Done another way." },
          answeredByUser: BY_ANN,
        }),
      ),
    );
    expect(outcome(byAnn).textContent).toBe("Dismissed by Ann Lee: Done another way.");
  });
});

describe("Dismiss", () => {
  it("asks why first, then sends the general comment as dismissed", async () => {
    const page = await rendered(card(MIXED));

    await click(buttonNamed("Dismiss"));
    expect(answerDecision).not.toHaveBeenCalled();
    const step = page.querySelector<HTMLElement>("section[aria-label='Dismiss']");
    expect(step?.textContent).toContain(
      "Closes the Decision unanswered. Angela learns of it with your next message in the Thread.",
    );
    expect(buttonsNamed("Submit")).toHaveLength(0);
    const why = fieldLabelled("Why dismiss it?");
    expect(why.placeholder).toBe("Your general comment, sent with your next message");
    type(why, "We dropped the export.");
    await click(buttonNamed("Dismiss", step!));
    await settle();

    expect(answerDecision).toHaveBeenCalledWith(DECISION_ID, {
      kind: "dismissed",
      generalComment: "We dropped the export.",
    });
  });

  it("lets Cancel leave the step, sending nothing", async () => {
    await rendered(card(aDecision()));

    await click(buttonNamed("Dismiss"));
    await click(buttonNamed("Cancel"));
    expect(buttonsNamed("Submit")).toHaveLength(1);
    expect(answerDecision).not.toHaveBeenCalled();
  });

  it("is offered on the compact card too", async () => {
    const page = await rendered(
      card(aDecision({ questions: [FORMAT, FILE_NAME, COLUMNS, FORMAT] })),
    );

    expect(buttonsNamed("Open details")).toHaveLength(1);
    await click(buttonNamed("Dismiss"));
    await click(buttonNamed("Dismiss", page.querySelector("section[aria-label='Dismiss']")!));
    await settle();

    expect(answerDecision).toHaveBeenCalledWith(DECISION_ID, { kind: "dismissed" });
  });

  it.each([
    ["in a Stage Thread", aDecision({ inStageThread: true })],
    ["on The Office's own", aDecision({ roleKey: null })],
    [
      "on an approval",
      aDecision({
        kind: "approval",
        questions: [
          {
            kind: "choice",
            question: "Run `rm -rf dist`?",
            options: ["Allow once", "Deny"],
            recommendation: { option: 0, reason: "It is the build's output." },
          },
        ],
      }),
    ],
    ["on one put to a Consultant", aDecision({ putTo: "reviewer" })],
  ])("is not offered %s", async (_where, decision) => {
    await rendered(card(decision));

    expect(buttonsNamed("Dismiss")).toHaveLength(0);
  });
});

describe("a choice of several", () => {
  const SEVERAL = aDecision({ questions: [STORES] });
  const QUESTION = "Where should the draft be kept?";
  const checked = (): boolean[] =>
    ["IndexedDB", "Cookies", "Local storage"].map((option) => checkbox(QUESTION, option).checked);

  it("starts with its recommended options checked and badged, with the hint and recommendation", async () => {
    const page = await rendered(card(SEVERAL));

    expect(checked()).toEqual([true, false, true]);
    const lines = [
      ...(page
        .querySelector(`[role='group'][aria-label='${QUESTION}']`)
        ?.querySelectorAll("label") ?? []),
    ].map((line) => line.textContent);
    expect(lines).toEqual(["IndexedDBRecommended", "Cookies", "Local storageRecommended"]);
    expect(page.textContent).toContain("Pick every option that applies.");
    expect(page.textContent).toContain(
      "Angela recommends “IndexedDB”, “Local storage”: Both survive a reload.",
    );
    expect(buttonsNamed("Add a comment")).toHaveLength(1);
  });

  it("sends the checked options in ascending order", async () => {
    await rendered(card(SEVERAL));

    await click(checkbox(QUESTION, "Local storage"));
    await click(checkbox(QUESTION, "Cookies"));
    expect(checked()).toEqual([true, true, false]);
    await click(buttonNamed("Submit"));
    await settle();

    expect(answerDecision).toHaveBeenCalledWith(DECISION_ID, {
      kind: "submitted",
      answers: [{ kind: "options", options: [0, 1] }],
    });
  });

  it("asks for words once no box is checked, and sends them", async () => {
    await rendered(card(SEVERAL));

    await click(checkbox(QUESTION, "IndexedDB"));
    await click(checkbox(QUESTION, "Local storage"));
    expect(buttonNamed("Submit").title).toBe("Pick an option or write your answer first.");
    expect(buttonsNamed("Add a comment")).toHaveLength(0);
    type(fieldLabelled("Your answer in words"), "Only in memory");
    await click(buttonNamed("Submit"));
    await settle();

    expect(answerDecision).toHaveBeenCalledWith(DECISION_ID, {
      kind: "submitted",
      answers: [{ kind: "words", text: "Only in memory" }],
    });
  });

  it("is accepted on the compact card with its recommended options", async () => {
    const page = await rendered(card(aDecision({ questions: [STORES, FORMAT, COLUMNS, FORMAT] })));

    expect(
      [...page.querySelectorAll(".decision-compact-recommended")].map((line) => line.textContent),
    ).toEqual(["IndexedDBRecommended", "Local storageRecommended"]);
    expect(page.textContent).toContain("Angela recommends them: Both survive a reload.");
    await click(buttonNamed("Accept"));
    await settle();

    expect(answerDecision).toHaveBeenCalledWith(DECISION_ID, {
      kind: "submitted",
      answers: [
        { kind: "options", options: [0, 2] },
        { kind: "option", option: 0 },
        { kind: "option", option: 1 },
        { kind: "option", option: 0 },
      ],
    });
  });

  it("lists the picks once answered, each recommended one marked", async () => {
    const page = await rendered(
      inThread(
        aDecision({
          questions: [STORES],
          formAnswer: { kind: "submitted", answers: [{ kind: "options", options: [0, 1] }] },
          answeredAt: "2026-11-10T14:30:00.000Z",
          answeredByUser: BY_YOU,
        }),
      ),
    );

    expect(page.querySelector(".decision-answer-words")?.textContent).toBe(
      "IndexedDB (recommended), Cookies",
    );
  });
});

describe("in the feed of Now and the Needs you panel", () => {
  it("folds a form of 2 questions into the compact card, Open details opening the window", async () => {
    await rendered(card(aDecision({ questions: [FORMAT, FILE_NAME] }), { where: "feed" }));

    expect(fieldsLabelled("Your answer")).toHaveLength(0);
    await click(buttonNamed("Open details"));
    expect(document.body.querySelector("[role='dialog']")).not.toBeNull();
    expect(document.body.querySelector("nav[aria-label='Questions']")?.textContent).toContain(
      "What is the file called?",
    );
  });

  it("keeps one question in place", async () => {
    await rendered(card(aDecision(), { where: "feed" }));

    expect(buttonsNamed("Open details")).toHaveLength(0);
    expect(buttonsNamed("Submit")).toHaveLength(1);
  });

  it("keeps a form of 2 questions in place on the Task's Needs you", async () => {
    await rendered(card(aDecision({ questions: [FORMAT, FILE_NAME] }), { where: "needs-you" }));

    expect(buttonsNamed("Open details")).toHaveLength(0);
    expect(fieldsLabelled("Your answer")).toHaveLength(1);
  });
});

describe("a closed Decision", () => {
  /** Closed unanswered, as its Task was dropped while it waited on a Consultant. */
  const closed = aDecision({
    putTo: "reviewer",
    closedAt: "2026-11-15T09:00:00.000Z",
    closedBecause: "task-dropped",
  });

  it("says its Task was dropped on its card, with nothing to answer or take over", async () => {
    const page = await rendered(card(closed));

    expect(outcome(page).textContent).toBe("Closed: the Task was dropped.");
    expect(page.querySelectorAll("[role='radiogroup']")).toHaveLength(0);
    expect(page.querySelector(".decision-consultation")).toBeNull();
    expect(page.textContent).not.toContain("A question first?");
    expect(page.querySelectorAll("button:not([aria-label='Copy link'])")).toHaveLength(0);
  });

  it("says so in its Thread, no longer waiting on anyone", async () => {
    const page = await rendered(inThread(closed));

    expect(outcome(page).textContent).toBe("Closed: the Task was dropped.");
    expect(page.textContent).not.toContain("Waiting on");
    expect(page.textContent).not.toContain("Needs you");
    expect(page.textContent).not.toContain("Open the Consultation");
  });
});

/** A Decision on no Task, about the Initiative as a whole, in its planning Thread. */
function onTheInitiative(fields: Partial<Decision> = {}): Decision {
  return aDecision({ threadId: PLANNING_THREAD, taskId: null, ...fields });
}

describe("a Decision on no Task in an Initiative's Thread", () => {
  it("is the whole form in place, answered there, on no Task and with no copy link", async () => {
    const page = await rendered(inThread(onTheInitiative({ questions: [FORMAT, FILE_NAME] })));

    const shown = page.querySelector<HTMLElement>(".decision-card");
    expect(shown?.id).toBe(`decision-card-${DECISION_ID}`);
    expect(page.querySelector(".decision-on-task")?.textContent).toBe(
      "On no Task: about the Initiative as a whole",
    );
    expect(page.querySelectorAll("[role='radiogroup']")).toHaveLength(1);
    expect(page.textContent).not.toContain("Needs you");
    expect(buttonsNamed("Copy link")).toHaveLength(0);
    await click(radio("Which format?", "CSV"));
    type(fieldLabelled("Your answer"), "usage.csv");
    await click(buttonNamed("Submit"));
    await settle();

    expect(answerDecision).toHaveBeenCalledWith(DECISION_ID, {
      kind: "submitted",
      answers: [
        { kind: "option", option: 0 },
        { kind: "words", text: "usage.csv" },
      ],
    });
  });

  it("is answered at once while the person answers, reaching them when the turn ends", async () => {
    const page = await rendered(inThread(onTheInitiative()), { threadState: "answering" });

    expect(buttonNamed("Submit").disabled).toBe(false);
    expect(page.textContent).toContain("Reaches Angela when this turn ends.");
  });

  it("is the compact card past the threshold, with Open details", async () => {
    await rendered(inThread(onTheInitiative({ questions: [FORMAT, FILE_NAME, COLUMNS, FORMAT] })));

    expect(buttonsNamed("Open details")).toHaveLength(1);
  });

  it("shows the answer once sent", async () => {
    const page = await rendered(
      inThread(answered({ threadId: PLANNING_THREAD, taskId: null, answeredByUser: BY_YOU })),
    );

    expect(page.querySelector(".decision-card")?.classList.contains("settled")).toBe(true);
    expect(outcome(page).textContent).toBe("Answered by you");
    expect(page.querySelector(".decision-on-task")?.textContent).toBe(
      "On no Task: about the Initiative as a whole",
    );
  });

  it("says the Initiative ended once closed", async () => {
    const page = await rendered(
      inThread(
        onTheInitiative({
          closedAt: "2026-11-15T09:00:00.000Z",
          closedBecause: "initiative-ended",
        }),
      ),
    );

    expect(outcome(page).textContent).toBe("Closed: the Initiative ended.");
    expect(page.querySelectorAll("[role='radiogroup']")).toHaveLength(0);
    expect(page.textContent).not.toContain("Waits on you");
  });
});

describe("a Decision waiting on the user in a chat", () => {
  const inChat = aDecision({ threadId: CHAT_THREAD, taskId: null, questions: [FORMAT, FILE_NAME] });

  it("is the whole form inline, answered there, with no way to Needs you", async () => {
    const page = await rendered(inThread(inChat));

    expect(page.querySelectorAll("[role='radiogroup']")).toHaveLength(1);
    expect(buttonsNamed("Submit")).toHaveLength(1);
    expect(buttonsNamed("Ask me again")).toHaveLength(1);
    expect(page.textContent).toContain("A question first? Ask Angela below");
    expect(page.textContent).not.toContain("Waits on you.");
    expect(page.textContent).not.toContain("Needs you");
    expect(page.querySelector("[aria-label='Copy link']")).toBeNull();

    await click(radio("Which format?", "JSON"));
    type(fieldLabelled("Your answer"), "usage.json");
    await click(buttonNamed("Submit"));
    await settle();
    expect(answerDecision).toHaveBeenCalledWith(DECISION_ID, {
      kind: "submitted",
      answers: [
        { kind: "option", option: 1 },
        { kind: "words", text: "usage.json" },
      ],
    });
  });

  it("waits while the person answers, saying why", async () => {
    const page = await rendered(inThread(inChat, true));

    expect(buttonNamed("Submit").disabled).toBe(true);
    expect(buttonNamed("Submit").title).toBe("Angela is still answering. Answer once they finish.");
    expect(buttonNamed("Ask me again").disabled).toBe(true);
    expect(page.textContent).toContain("Angela is still answering. Answer once they finish.");
  });

  it("is an approval's one click per option", async () => {
    await rendered(
      inThread(
        aDecision({
          threadId: CHAT_THREAD,
          taskId: null,
          kind: "approval",
          questions: [
            {
              kind: "choice",
              question: "Install ffmpeg on the machine",
              options: ["Allow once", "Deny"],
              recommendation: { option: 0, reason: "The thumbnails need it." },
            },
          ],
        }),
      ),
    );

    await click(buttonNamed("Allow once"));
    await settle();
    expect(answerDecision).toHaveBeenCalledWith(DECISION_ID, {
      kind: "submitted",
      answers: [{ kind: "option", option: 0 }],
    });
  });

  it("shows the answered form once sent", async () => {
    const page = await rendered(
      inThread({
        ...inChat,
        formAnswer: {
          kind: "submitted",
          answers: [
            { kind: "option", option: 0 },
            { kind: "words", text: "usage.csv" },
          ],
        },
        answeredAt: "2026-11-10T14:30:00.000Z",
        answeredByUser: BY_YOU,
      }),
    );

    expect(page.querySelector(".decision-card")?.classList.contains("settled")).toBe(true);
    expect(
      [...page.querySelectorAll(".decision-answer-words")].map(({ textContent }) => textContent),
    ).toEqual(["CSV (recommended)", "usage.csv"]);
    expect(outcome(page).textContent).toBe("Answered by you");
    expect(buttonsNamed("Submit")).toHaveLength(0);
  });

  it("keeps a call put to a Consultant as the line waiting on them", async () => {
    const page = await rendered(inThread({ ...inChat, putTo: "reviewer" }));

    expect(page.querySelectorAll("[role='radiogroup']")).toHaveLength(0);
    expect(page.querySelector(".decision-hint")?.textContent).toContain(
      "Waiting on Michael in a Consultation.",
    );
  });

  it("leaves a Task Thread's Decision the short line leading to Needs you", async () => {
    const page = await rendered(inThread(aDecision(), true));

    expect(page.querySelectorAll("[role='radiogroup']")).toHaveLength(0);
    expect(page.querySelector(".decision-hint")?.textContent).toContain("Waits on you.");
    expect(
      [...page.querySelectorAll("a")].some((link) => link.textContent === "Answer it in Needs you"),
    ).toBe(true);
  });
});

describe("a call made from a chat", () => {
  const CALLERS_CHAT = "1d0e9f8a-7b6c-4d5e-8f4a-3b2c1d0e9f8a";
  const CONSULTATION = "2e1f0a9b-8c7d-4e6f-9a5b-4c3d2e1f0a9b";
  const call = aDecision({
    threadId: CALLERS_CHAT,
    kind: "request",
    taskId: null,
    questions: [
      {
        kind: "open",
        question: "Set up the Project's commands.",
        why: "Only Michael drafts them.",
      },
    ],
    putTo: "reviewer",
  });

  async function renderedInChat(decision: Decision): Promise<HTMLElement> {
    const consultation = {
      id: CONSULTATION,
      home: { kind: "chat", roleKey: "reviewer" },
      roleKey: "reviewer",
      state: "waiting",
      stageThread: false,
      stageContextLimits: null,
      consultation: {
        decisionId: decision.id,
        askerThreadId: CALLERS_CHAT,
        askerRoleKey: "planner",
      },
    } as Thread;
    const queryClient = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity, retry: false } },
    });
    queryClient.setQueryData(roleQueries.list().queryKey, [PLANNER, REVIEWER]);
    queryClient.setQueryData(threadQueries.one(CALLERS_CHAT).queryKey, {
      id: CALLERS_CHAT,
      home: { kind: "chat", roleKey: "planner" },
      roleKey: "planner",
      state: "waiting",
      stageThread: false,
      stageContextLimits: null,
    } as Thread);
    queryClient.setQueryData(threadQueries.one(CONSULTATION).queryKey, consultation);
    queryClient.setQueryData(threadQueries.inChat("reviewer").queryKey, {
      pages: [{ rows: [consultation], next: null, total: 1 }],
      pageParams: [undefined],
    });
    const router = createRouter({
      routeTree: createRootRoute({ component: inThread(decision) }),
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    const page = document.createElement("div");
    document.body.append(page);
    await act(async () => {
      createRoot(page).render(
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <DecisionDraftsProvider>
              <RouterProvider router={router} />
            </DecisionDraftsProvider>
          </ToastProvider>
        </QueryClientProvider>,
      );
      await router.load();
    });
    return page;
  }

  it("reads as what the caller asked, linking to the Consultation, with no Needs you", async () => {
    const page = await renderedInChat(call);

    expect(page.querySelector(".decision-question")?.textContent).toBe(
      "Asked Michael to: Set up the Project's commands.",
    );
    const links = [...page.querySelectorAll("a")];
    expect(links.some((link) => link.textContent?.includes("Needs you"))).toBe(false);
    expect(
      links.find((link) => link.textContent === "Open the Consultation")?.getAttribute("href"),
    ).toBe(`/?chat=reviewer&thread=${CONSULTATION}`);
    expect(page.querySelector("[aria-label='Copy link']")).toBeNull();
  });

  it("shows the callee's answer in words, and The Office's when it went back to the caller", async () => {
    const byCallee = await renderedInChat({
      ...call,
      formAnswer: {
        kind: "submitted",
        answers: [{ kind: "words", text: "I drafted a Proposal." }],
      },
      answeredAt: "2026-11-12T14:30:00.000Z",
      answeredBy: "reviewer",
    });
    expect(byCallee.querySelector(".decision-answer-words")?.textContent).toBe(
      "I drafted a Proposal.",
    );
    expect(outcome(byCallee).textContent).toContain("Answered by Michael in a Consultation");
    document.body.replaceChildren();

    const byTheOffice = await renderedInChat({
      ...call,
      formAnswer: {
        kind: "asked-again",
        generalComment: "So it is the user's now: ask them in your reply.",
      },
      answeredAt: "2026-11-12T14:30:00.000Z",
      answeredByTheOffice: true,
    });
    expect(byTheOffice.querySelectorAll(".decision-answer")).toHaveLength(0);
    expect(outcome(byTheOffice).textContent).toBe(
      "Answered by The Office: So it is the user's now: ask them in your reply.",
    );
  });
});
