import type { Thread } from "@the-office/contracts";
import { useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api/api-client.ts";
import { answerDecision } from "../../api/conversations.ts";
import {
  aDecision,
  buttonNamed,
  click,
  COLUMNS,
  FORMAT,
  radio,
  rendered,
  settle,
  TASK_THREAD,
} from "./decision-card.fixtures.tsx";
import { DecisionCard } from "./decision-card.tsx";

vi.mock("../../api/conversations.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/conversations.ts")>()),
  answerDecision: vi.fn<typeof import("../../api/conversations.ts").answerDecision>(),
}));

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const DECISION = aDecision({ questions: [FORMAT, COLUMNS] });

/** The same Decision twice, as on the Task's page and in the Needs you panel, the panel closable. */
function TwoViews(): ReactNode {
  const [panelOpen, setPanelOpen] = useState(true);
  return (
    <>
      <div id="page">
        <DecisionCard decision={DECISION} personName="Angela" answering={false} followUps />
      </div>
      <button type="button" onClick={() => setPanelOpen(!panelOpen)}>
        Toggle the panel
      </button>
      {panelOpen && (
        <div id="panel">
          <DecisionCard decision={DECISION} personName="Angela" answering={false} followUps />
        </div>
      )}
    </>
  );
}

function within(id: string): HTMLElement {
  const place = document.getElementById(id);
  if (place === null) throw new Error(`No #${id}.`);
  return place;
}

beforeEach(() => {
  vi.mocked(answerDecision).mockReset();
});
afterEach(() => document.body.replaceChildren());

describe("a Decision's draft", () => {
  it("is shared by every view of the Decision", async () => {
    await rendered(TwoViews);

    await click(radio("Which format?", "JSON", within("page")));
    expect(radio("Which format?", "JSON", within("panel")).checked).toBe(true);
  });

  it("survives its view being closed and opened again", async () => {
    await rendered(TwoViews);

    await click(radio("Which columns?", "All", within("panel")));
    await click(buttonNamed("Toggle the panel"));
    expect(document.getElementById("panel")).toBeNull();
    await click(buttonNamed("Toggle the panel"));
    expect(radio("Which columns?", "All", within("panel")).checked).toBe(true);
  });

  it("is cleared once sent", async () => {
    vi.mocked(answerDecision).mockResolvedValue({ id: TASK_THREAD } as Thread);
    await rendered(TwoViews);

    await click(radio("Which format?", "JSON", within("page")));
    await click(buttonNamed("Submit", within("page")));
    await settle();

    expect(answerDecision).toHaveBeenCalledOnce();
    expect(radio("Which format?", "CSV", within("panel")).checked).toBe(true);
  });

  it("is kept when the answer is refused", async () => {
    vi.mocked(answerDecision).mockRejectedValue(new ApiError(409, "Answered already."));
    await rendered(TwoViews);

    await click(radio("Which format?", "JSON", within("page")));
    await click(buttonNamed("Submit", within("page")));
    await settle();

    expect(radio("Which format?", "JSON", within("page")).checked).toBe(true);
    expect(radio("Which format?", "JSON", within("panel")).checked).toBe(true);
  });
});
