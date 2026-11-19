import type { Attachment, Decision, Thread } from "@the-office/contracts";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { answerDecision } from "../../api/conversations.ts";
import {
  aDecision,
  buttonNamed,
  buttonsNamed,
  click,
  COLUMNS,
  DECISION_ID,
  fieldLabelled,
  FILE_NAME,
  FORMAT,
  radio,
  rendered,
  settle,
  TASK_THREAD,
  type,
} from "./decision-card.fixtures.tsx";
import { DecisionOnTask } from "./decision-on-task.tsx";

vi.mock("../../api/conversations.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/conversations.ts")>()),
  answerDecision: vi.fn<typeof import("../../api/conversations.ts").answerDecision>(),
}));

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** Four choices: past the compact threshold. */
const LONG = aDecision({
  context: "Usage goes to finance once a month.\nThey open it in a spreadsheet.",
  questions: [FORMAT, COLUMNS, FORMAT, COLUMNS],
});
/** A form of one question with a picture to look at. */
const ATTACHED = aDecision({ questions: [FORMAT], attachmentIds: ["shot"] });
const SHOT = {
  id: "shot",
  kind: "image",
  name: "export.png",
  url: "/attachments/shot",
} as unknown as Attachment;

function onTask(decision: Decision, answering = false): () => ReactNode {
  return () => (
    <DecisionOnTask decision={decision} personName="Angela" answering={answering} followUps />
  );
}

function windowElement(): HTMLElement {
  const shown = document.querySelector<HTMLElement>("[role='dialog']");
  if (shown === null) throw new Error("No window is open.");
  return shown;
}

beforeEach(() => {
  vi.mocked(answerDecision).mockReset();
  vi.mocked(answerDecision).mockResolvedValue({ id: TASK_THREAD } as Thread);
});
afterEach(() => document.body.replaceChildren());

describe("the compact card", () => {
  it("shows the context's first line, question 1 with its recommendation, and how many more", async () => {
    const page = await rendered(onTask(LONG));

    expect(page.querySelector(".decision-context")?.textContent).toBe(
      "Usage goes to finance once a month.",
    );
    const first = page.querySelector("section[aria-label='Question 1']");
    expect(first?.textContent).toContain("Question 1 of 4");
    expect(first?.textContent).toContain("Which format?");
    expect(first?.textContent).toContain("CSVRecommended");
    expect(first?.textContent).toContain("Angela recommends it: Spreadsheets open it.");
    expect(page.querySelector(".decision-compact-more")?.textContent).toBe("3 more questions");
    expect(page.querySelector(".decision-progress")?.textContent).toContain("4 of 4 answered");
    expect(page.querySelectorAll("[role='radiogroup']")).toHaveLength(0);
  });

  it("accepts every recommended option in one click while every question is a choice", async () => {
    await rendered(onTask(LONG));

    await click(buttonNamed("Accept"));
    await settle();

    expect(answerDecision).toHaveBeenCalledWith(DECISION_ID, {
      kind: "submitted",
      answers: [
        { kind: "option", option: 0 },
        { kind: "option", option: 1 },
        { kind: "option", option: 0 },
        { kind: "option", option: 1 },
      ],
    });
  });

  it("offers no Accept once a question is open, nor while the person answers", async () => {
    await rendered(onTask(aDecision({ questions: [FORMAT, FILE_NAME, COLUMNS, FORMAT] })));
    expect(buttonsNamed("Accept")).toHaveLength(0);
    expect(document.body.querySelector(".decision-compact-more")?.textContent).toBe(
      "3 more questions, 1 of them open question",
    );
    document.body.replaceChildren();

    await rendered(onTask(LONG, true));
    expect(buttonNamed("Accept").disabled).toBe(true);
    expect(buttonNamed("Accept").title).toBe("Angela is still answering. Answer once they finish.");
  });

  it("is compact with an Attachment, however short", async () => {
    const page = await rendered(onTask(ATTACHED), { attachments: [SHOT] });

    expect(page.querySelector("section[aria-label='Question 1']")?.textContent).toContain(
      "The question",
    );
    expect(page.querySelector(".decision-compact-more")?.textContent).toBe(
      "1 Attachment to look at in Open details",
    );
    expect(buttonsNamed("Open details")).toHaveLength(1);
  });
});

describe("Open details", () => {
  it("opens the window: the questions listed, the picked one, and Submit in the bar", async () => {
    await rendered(onTask(LONG));

    await click(buttonNamed("Open details"));
    const shown = windowElement();
    const rows = [...shown.querySelectorAll("nav[aria-label='Questions'] button")].map(
      (row) => row.querySelector(".decision-window-row-state")?.textContent,
    );
    expect(rows).toEqual([
      "CSV (recommended)",
      "Only totals (recommended)",
      "CSV (recommended)",
      "Only totals (recommended)",
    ]);
    expect(shown.textContent).toContain("Question 1 of 4");
    expect(shown.querySelectorAll("[role='radiogroup']")).toHaveLength(1);

    await click(buttonNamed("Next", shown));
    expect(shown.textContent).toContain("Question 2 of 4");
    expect(radio("Which columns?", "Only totals", shown).checked).toBe(true);
    expect(buttonNamed("Submit", shown).disabled).toBe(false);
  });

  it("keeps the draft when closed, the card saying so in place of Accept", async () => {
    const page = await rendered(onTask(LONG));

    await click(buttonNamed("Open details"));
    await click(radio("Which format?", "JSON", windowElement()));
    await click(buttonNamed("Close"));
    expect(document.querySelector("[role='dialog']")).toBeNull();

    expect(buttonsNamed("Accept")).toHaveLength(0);
    expect(page.textContent).toContain("Draft kept · 1 change");
    await click(buttonNamed("Open details"));
    expect(radio("Which format?", "JSON", windowElement()).checked).toBe(true);
  });

  it("opens at the question the progress line names", async () => {
    const page = await rendered(
      onTask(aDecision({ questions: [FORMAT, COLUMNS, FILE_NAME, FORMAT] })),
    );

    expect(page.querySelector(".decision-progress")?.textContent).toContain("3 of 4 answered");
    await click(buttonNamed("Question 3 needs an answer"));
    const shown = windowElement();
    expect(shown.textContent).toContain("Question 3 of 4");
    type(fieldLabelled("Your answer", shown), "usage.csv");
    await click(buttonNamed("Submit", shown));
    await settle();

    expect(answerDecision).toHaveBeenCalledWith(DECISION_ID, {
      kind: "submitted",
      answers: [
        { kind: "option", option: 0 },
        { kind: "option", option: 1 },
        { kind: "words", text: "usage.csv" },
        { kind: "option", option: 0 },
      ],
    });
    expect(document.querySelector("[role='dialog']")).toBeNull();
  });

  it("offers Submit in Next's place on the last question, sending from there", async () => {
    await rendered(onTask(LONG));

    await click(buttonNamed("Open details"));
    const shown = windowElement();
    await click(
      shown.querySelectorAll<HTMLButtonElement>("nav[aria-label='Questions'] button")[3]!,
    );
    const nav = shown.querySelector<HTMLElement>(".decision-window-nav")!;
    expect(buttonsNamed("Next").filter((button) => nav.contains(button))).toHaveLength(0);
    await click(buttonNamed("Submit", nav));
    await settle();

    expect(answerDecision).toHaveBeenCalledOnce();
    expect(document.querySelector("[role='dialog']")).toBeNull();
  });

  it("locks a Decision put to a Consultant in the window too, until taken over", async () => {
    await rendered(onTask(aDecision({ ...LONG, putTo: "reviewer" })));

    expect(buttonNamed("Accept").disabled).toBe(true);
    expect(buttonNamed("Accept").title).toBe("Take it over first.");
    await click(buttonNamed("Open details"));
    const shown = windowElement();
    expect(buttonNamed("Submit", shown).disabled).toBe(true);
    expect(radio("Which format?", "JSON", shown).disabled).toBe(true);

    await click(buttonNamed("Take it over", shown));
    expect(buttonsNamed("Take it over")).toHaveLength(0);
    expect(buttonNamed("Submit", shown).disabled).toBe(false);
    await click(buttonNamed("Close"));
    expect(buttonNamed("Accept").disabled).toBe(false);
  });

  it("shows a one-question window as the form alone, with its Attachments", async () => {
    await rendered(onTask(ATTACHED), { attachments: [SHOT] });

    await click(buttonNamed("Open details"));
    const shown = windowElement();
    expect(shown.querySelector("nav[aria-label='Questions']")).toBeNull();
    expect(shown.textContent).toContain("Context and 1 Attachment");
    expect(radio("Which format?", "CSV", shown).checked).toBe(true);
  });
});
