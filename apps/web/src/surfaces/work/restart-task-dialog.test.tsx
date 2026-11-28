import type { TaskStage, TaskStages } from "@the-office/contracts";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api/api-client.ts";
import { pipelineQueries } from "../../api/pipelines.ts";
import type { restartTask } from "../../api/work.ts";
import { until } from "../../shell/page.fixtures.tsx";
import { RestartTaskDialog } from "./restart-task-dialog.tsx";
import { button, rendered, TASK, unmounted, written } from "./way-back-dialogs.fixtures.tsx";

const api = vi.hoisted(() => ({ restartTask: vi.fn<typeof restartTask>() }));
vi.mock("../../api/work.ts", async (original) => ({
  ...(await original<typeof import("../../api/work.ts")>()),
  restartTask: api.restartTask,
}));

function aStage(key: string, name: string, state: TaskStage["state"]): TaskStage {
  return { stage: { key, name }, state, runs: [] } as unknown as TaskStage;
}

const STAGES = {
  stages: [
    aStage("implement", "Implement", "done"),
    aStage("review", "Review", "paused"),
    aStage("publish", "Publish", "pending"),
  ],
  definitionOfDoneMet: [],
} as unknown as TaskStages;

const onClose = vi.fn<() => void>();

function open(): void {
  rendered(<RestartTaskDialog task={TASK} onClose={onClose} />, (queryClient) =>
    queryClient.setQueryData(pipelineQueries.taskStages(TASK.id).queryKey, STAGES),
  );
}

function picker(): HTMLSelectElement {
  const select = document.body.querySelector("select");
  if (!select) throw new Error("There is no Stage picker.");
  return select;
}

describe("Restart from…", () => {
  afterEach(() => {
    unmounted();
    vi.clearAllMocks();
  });

  it("offers every Stage of the Pipeline, the held one picked at first", () => {
    open();

    expect(document.body.textContent).toContain(`Restart ${TASK.title} from…`);
    expect([...picker().options].map((option) => option.textContent)).toEqual([
      "Implement",
      "Review",
      "Publish",
    ]);
    expect(picker().value).toBe("review");
    expect(document.body.textContent).toContain(
      "The held run ends, and the uncommitted edits Pause kept are discarded.",
    );
  });

  it("restarts from the Stage picked, with the feedback written, and says so", async () => {
    api.restartTask.mockResolvedValue();
    open();
    act(() => {
      picker().value = "publish";
      picker().dispatchEvent(new Event("change", { bubbles: true }));
    });
    written("Feedback", "  Mind the edge case.  ");

    await act(async () => button("Restart").click());

    await until(() =>
      expect(api.restartTask).toHaveBeenCalledWith(TASK.id, {
        stageKey: "publish",
        feedback: "Mind the edge case.",
      }),
    );
    await until(() => expect(document.body.textContent).toContain("Restarted from Publish."));
    expect(onClose).toHaveBeenCalled();
  });

  it("sends no feedback when none is written", async () => {
    api.restartTask.mockResolvedValue();
    open();

    await act(async () => button("Restart").click());

    await until(() =>
      expect(api.restartTask).toHaveBeenCalledWith(TASK.id, { stageKey: "review" }),
    );
  });

  it("shows every reason of a refusal and stays open", async () => {
    api.restartTask.mockRejectedValue(
      new ApiError(422, "Refused", ["The Task isn't paused by your Pause or Stop."]),
    );
    open();

    await act(async () => button("Restart").click());

    await until(() => expect(document.body.textContent).toContain("The Task can't be restarted"));
    expect(document.body.textContent).toContain("The Task isn't paused by your Pause or Stop.");
    expect(onClose).not.toHaveBeenCalled();
  });
});
