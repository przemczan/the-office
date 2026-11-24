import type { Task } from "@the-office/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../shell/work/use-planner.ts", () => ({ usePlanner: () => undefined }));
vi.mock("./commit-message-block.tsx", () => ({ CommitMessageBlock: () => <i>Commit message</i> }));
vi.mock("./description-block.tsx", () => ({ DescriptionBlock: () => <i>Description</i> }));
vi.mock("./devices-block.tsx", () => ({ DevicesBlock: () => <i>Devices</i> }));
vi.mock("./history-block.tsx", () => ({ HistoryBlock: () => <i>History</i> }));
vi.mock("./planning-parts.tsx", () => ({
  PlanBlock: () => <i>Plan</i>,
  DefinitionOfDoneBlock: () => <i>Definition of Done</i>,
}));
vi.mock("./work-engine-block.tsx", () => ({ TaskEngineBlock: () => <i>Engine</i> }));

import { TaskRecord } from "./task-record.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("TaskRecord", () => {
  it("shows the Overview's blocks in order, without the Engine block", () => {
    const page = document.createElement("div");
    document.body.append(page);
    act(() => createRoot(page).render(<TaskRecord task={{ id: "t1" } as Task} />));
    expect([...page.querySelectorAll("i")].map((block) => block.textContent)).toEqual([
      "Description",
      "Plan",
      "Definition of Done",
      "Commit message",
      "Devices",
      "History",
    ]);
  });
});
