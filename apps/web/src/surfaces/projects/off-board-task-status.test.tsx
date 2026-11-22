import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buttonWith,
  DECISION_ID,
  linkWith,
  offBoardTask,
  pressed,
  rendered,
  serving,
  TASK_ID,
  THREAD_ID,
} from "./off-board-task.fixtures.tsx";
import { OffBoardTaskStatus } from "./off-board-task-status.tsx";

const navigated = vi.hoisted(() => vi.fn<(to: unknown) => void>());

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    params,
    search,
  }: {
    children: ReactNode;
    to: string;
    params: { taskId: string };
    search?: Record<string, string>;
  }) => (
    <a
      href={`${to.replace("$taskId", params.taskId)}${search ? `?${new URLSearchParams(search).toString()}` : ""}`}
    >
      {children}
    </a>
  ),
  useNavigate: () => navigated,
}));

vi.mock("../../shell/use-duty-holder.ts", () => ({
  useDutyHolder: () => ({
    holder: { key: "cto", card: { name: "Michael", title: "CTO" } },
    label: "Asked first when a Stage runs out of tries",
    fallback: undefined,
  }),
}));

afterEach(() => {
  navigated.mockReset();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("an Off-board Task's status", () => {
  it("queued: its place in the queue and the short reasons, its Stages not started", async () => {
    serving(() => []);
    const { page } = await rendered(
      <OffBoardTaskStatus
        task={offBoardTask(
          {
            state: "queued",
            place: 2,
            shortReasons: ["Project limit reached (1)"],
            queuedAt: new Date(Date.now() - 4 * 60_000).toISOString(),
          },
          { currentStage: null, person: null, threadId: null },
        )}
      />,
    );
    expect(page.textContent).toContain("Queued");
    expect(page.textContent).toContain("Place 2 in the queue");
    expect(page.textContent).toContain("Project limit reached (1)");
    expect(page.textContent).toContain("Queued for 4 min");
    expect(page.querySelectorAll(".off-board-task-stage")).toHaveLength(3);
    expect(page.querySelector(".off-board-task-stage.now")).toBeNull();
    expect(linkWith(page, "Open the Task")?.getAttribute("href")).toBe(`/tasks/${TASK_ID}`);
  });

  it("running: who works it, time in Stage, tokens, and Open the Thread", async () => {
    serving(() => []);
    const { page } = await rendered(
      <OffBoardTaskStatus task={offBoardTask({ state: "running" }, { currentStage: "Verify" })} />,
    );
    expect(page.textContent).toContain("Running");
    expect(page.textContent).toContain("Dwight");
    expect(page.textContent).toContain("12 min in Stage");
    expect(page.textContent).toContain("184k tokens");
    expect(page.querySelector(".off-board-task-stage.done")?.textContent).toBe("Onboard");
    expect(page.querySelector(".off-board-task-stage.now")?.textContent).toBe("Verify");
    expect(linkWith(page, "Open the Thread")?.getAttribute("href")).toBe(
      `/tasks/${TASK_ID}?taskThread=${THREAD_ID}`,
    );
  });

  it("waiting on you: the question, and Answer opens it on the Task page", async () => {
    serving(() => []);
    const { page } = await rendered(
      <OffBoardTaskStatus
        task={offBoardTask({
          state: "waiting-on-you",
          decisionId: DECISION_ID,
          question: "Install Gradle 8.10 on the workstation?",
        })}
      />,
    );
    expect(page.textContent).toContain("Dwight asks: Install Gradle 8.10 on the workstation?");
    buttonWith(page, "Answer")?.click();
    expect(navigated).toHaveBeenCalledWith({
      to: "/tasks/$taskId",
      params: { taskId: TASK_ID },
      search: { decision: DECISION_ID },
    });
  });

  it("paused: Resume resumes the Task", async () => {
    const fetched = serving(() => ({}));
    const { page, queryClient } = await rendered(
      <OffBoardTaskStatus task={offBoardTask({ state: "paused" })} />,
    );
    const resume = buttonWith(page, "Resume");
    expect(resume).toBeDefined();
    if (resume) await pressed(resume, queryClient);
    const post = fetched.mock.calls.find(([, request]) => request?.method === "POST");
    expect(post?.[0]).toBe(`/api/tasks/${TASK_ID}/resume`);
  });

  it("failed with the CTO: says who was asked first, with no Retry", async () => {
    serving(() => []);
    const { page } = await rendered(
      <OffBoardTaskStatus
        task={offBoardTask(
          {
            state: "failed",
            stageName: "Verify",
            error: "npm test exited 1",
            decisionId: DECISION_ID,
            withCto: true,
          },
          { currentStage: "Verify" },
        )}
      />,
    );
    expect(page.textContent).toContain("Verify failed, and its rounds are used up.");
    expect(page.textContent).toContain(
      "Asked Michael (CTO) first. It comes to you, here and in Needs you, if Michael passes it on.",
    );
    expect(buttonWith(page, "Retry")).toBeUndefined();
    expect(page.querySelector(".off-board-task-stage.fail")?.textContent).toBe("Verify");
  });

  it("failed: the error, and Retry answers the Decision with its first option", async () => {
    const fetched = serving(() => ({}));
    const { page, queryClient } = await rendered(
      <OffBoardTaskStatus
        task={offBoardTask(
          {
            state: "failed",
            stageName: "Verify",
            error: "npm test exited 1: 3 of 214 tests failed",
            decisionId: DECISION_ID,
            withCto: false,
          },
          { currentStage: "Verify" },
        )}
      />,
    );
    expect(page.textContent).toContain("npm test exited 1: 3 of 214 tests failed");
    expect(page.textContent).toContain("Retry runs Verify again, with the failure in its Brief.");
    const retry = buttonWith(page, "Retry");
    expect(retry).toBeDefined();
    if (retry) await pressed(retry, queryClient);
    const post = fetched.mock.calls.find(([, request]) => request?.method === "POST");
    expect(post?.[0]).toBe(`/api/decisions/${DECISION_ID}/answer`);
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({
      kind: "submitted",
      answers: [{ kind: "option", option: 0 }],
    });

    buttonWith(page, "Open the Decision")?.click();
    expect(navigated).toHaveBeenCalledWith({
      to: "/tasks/$taskId",
      params: { taskId: TASK_ID },
      search: { decision: DECISION_ID },
    });
  });

  it("done: when and the tokens, with no Stages", async () => {
    serving(() => []);
    const { page } = await rendered(
      <OffBoardTaskStatus
        task={offBoardTask({ state: "done", endedAt: "2026-11-18T14:02:00.000Z" })}
      />,
    );
    expect(page.textContent).toContain("Done");
    expect(page.textContent).toMatch(/Done on 1[89] Nov/);
    expect(page.querySelectorAll(".off-board-task-stage")).toHaveLength(0);
  });

  it("dropped: when and why", async () => {
    serving(() => []);
    const { page } = await rendered(
      <OffBoardTaskStatus
        task={offBoardTask({
          state: "dropped",
          endedAt: "2026-11-19T09:15:00.000Z",
          dropReason: "Wrong base branch",
        })}
      />,
    );
    expect(page.textContent).toMatch(/Dropped on 19 Nov/);
    expect(page.textContent).toContain("“Wrong base branch”");
  });

  it("made before, Ready: Start starts it", async () => {
    const fetched = serving(() => ({}));
    const { page, queryClient } = await rendered(
      <OffBoardTaskStatus task={offBoardTask({ state: "ready" })} />,
    );
    expect(page.textContent).toContain(
      "Made before Off-board Tasks started at once, so it waits for your Start.",
    );
    const start = buttonWith(page, "Start");
    if (start) await pressed(start, queryClient);
    const post = fetched.mock.calls.find(([, request]) => request?.method === "POST");
    expect(post?.[0]).toBe(`/api/tasks/${TASK_ID}/start`);
  });
});
