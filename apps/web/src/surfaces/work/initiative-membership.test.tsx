import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Initiative, Task } from "@the-office/contracts";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../shell/toasts.tsx";
import { AddExistingTaskDialog, TakeOutDialog } from "./initiative-membership.tsx";
import { tasksToAdd, tasksToTakeOut } from "./initiative-membership-words.ts";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const INITIATIVE: Initiative = {
  id: "3f0c2b1a-9d8e-4f7a-8b6c-5d4e3f2a1b0c",
  name: "Offline sync",
  outcome: "",
  state: "active",
  originIdeaId: null,
  projectIds: ["mobile"],
  createdBy: { kind: "user", user: null },
  createdAt: "2026-11-10T09:00:00.000Z",
  endedAt: null,
  archivedAt: null,
  pausedAt: null,
  planningThreadId: null,
  planningAutoMode: false,
  pipelines: [],
  shortName: null,
  engine: null,
  branches: [],
};

function aTask(index: number, fields: Partial<Task> = {}): Task {
  return {
    id: `6f1c2b3a-9d8e-4f7a-8b6c-5d4e3f2a1b0${index}`,
    title: `Task ${index}`,
    projectId: "mobile",
    state: "backlog",
    initiativeId: null,
    initiativePlanningThreadId: null,
    madeFor: null,
    resolvesTaskId: null,
    archivedAt: null,
    ...fields,
  } as Task;
}

function render(dialog: ReactNode): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  queryClient.setQueryData(["projects"], []);
  const page = document.createElement("div");
  document.body.append(page);
  act(() =>
    createRoot(page).render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>{dialog}</ToastProvider>
      </QueryClientProvider>,
    ),
  );
}

function button(name: string): HTMLButtonElement | undefined {
  // A button's text is followed by its spinner's style.
  return [...document.body.querySelectorAll("button")].find((found) =>
    found.textContent.startsWith(name),
  );
}

/** The service's answer to every request, kept with what was asked. */
function answering(status: number, body: unknown) {
  const sent = vi.fn<typeof fetch>(() => Promise.resolve(Response.json(body, { status })));
  vi.stubGlobal("fetch", sent);
  return sent;
}

async function press(name: string): Promise<void> {
  await act(async () => {
    button(name)?.click();
    await new Promise((resolve) => setTimeout(resolve));
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("Take out", () => {
  it("asks first, saying what happens to the Task's state, and takes it out on the declared route", async () => {
    const planned = aTask(1, {
      initiativeId: INITIATIVE.id,
      state: "planning",
      initiativePlanningThreadId: "8f1c2b3a-9d8e-4f7a-8b6c-5d4e3f2a1b0c",
    });
    const sent = answering(200, { ...planned, initiativeId: null, state: "backlog" });
    render(
      <TakeOutDialog
        initiative={INITIATIVE}
        candidates={[planned]}
        projects={[]}
        onClose={() => undefined}
      />,
    );

    expect(document.body.textContent).toContain("Take Task 1 out of Offline sync?");
    expect(document.body.textContent).toContain(
      "It is planned in the Initiative's planning Thread, so it goes back to Backlog. What it waits for stays.",
    );
    await press("Take out");

    expect(sent.mock.calls[0]?.[0]).toBe(`/api/initiatives/${INITIATIVE.id}/tasks/${planned.id}`);
    expect(sent.mock.calls[0]?.[1]).toMatchObject({ method: "DELETE" });
  });

  it("shows the service's refusal in the window", async () => {
    const refusal = 'A Task leaves its Initiative before it starts; "Task 1" is In progress.';
    answering(422, { statusCode: 422, message: refusal, reasons: [refusal] });
    render(
      <TakeOutDialog
        initiative={INITIATIVE}
        candidates={[aTask(1, { initiativeId: INITIATIVE.id })]}
        projects={[]}
        onClose={() => undefined}
      />,
    );

    await press("Take out");

    expect(document.body.textContent).toContain("It can't be taken out");
    expect(document.body.textContent).toContain(refusal);
  });

  it("offers only the Initiative's Tasks that haven't started and The Office didn't make", () => {
    const tasks = [
      aTask(1, { initiativeId: INITIATIVE.id }),
      aTask(2, { initiativeId: INITIATIVE.id, state: "in-progress" }),
      aTask(3, { initiativeId: INITIATIVE.id, madeFor: "publishing", state: "ready" }),
      aTask(4),
    ];

    expect(tasksToTakeOut(INITIATIVE, tasks).map(({ title }) => title)).toEqual(["Task 1"]);
  });
});

describe("Add an existing Task", () => {
  it("lists the Tasks in no Initiative that can join, and adds the chosen one on the declared route", async () => {
    const tasks = [
      aTask(1),
      aTask(2, { initiativeId: "5f0c2b1a-9d8e-4f7a-8b6c-5d4e3f2a1b0c" }),
      aTask(3, { state: "done" }),
      aTask(4, { madeFor: "onboard" }),
    ];
    const candidates = tasksToAdd(INITIATIVE, tasks);
    const sent = answering(200, { ...tasks[0], initiativeId: INITIATIVE.id });
    render(
      <AddExistingTaskDialog
        initiative={INITIATIVE}
        candidates={candidates}
        onClose={() => undefined}
      />,
    );

    expect(candidates.map(({ title }) => title)).toEqual(["Task 1"]);
    const option = document.body.querySelector<HTMLElement>('[role="radio"]');
    act(() => option?.closest("label")?.click());
    expect(document.body.textContent).toContain("It stays in Backlog.");
    await press("Add the Task");

    expect(sent.mock.calls[0]?.[0]).toBe(`/api/initiatives/${INITIATIVE.id}/tasks/${tasks[0]?.id}`);
    expect(sent.mock.calls[0]?.[1]).toMatchObject({ method: "PUT" });
  });

  it("offers an Initiative being shaped only Tasks in Backlog", () => {
    const shaping = { ...INITIATIVE, state: "shaping" as const };

    expect(
      tasksToAdd(shaping, [aTask(1), aTask(2, { state: "ready" })]).map(({ title }) => title),
    ).toEqual(["Task 1"]);
  });
});
