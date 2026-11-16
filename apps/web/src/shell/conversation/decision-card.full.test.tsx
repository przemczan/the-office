import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import type { Decision, Role, Task, Thread } from "@the-office/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { threadQueries } from "../../api/conversations.ts";
import { roleQueries } from "../../api/people.ts";
import { taskQueries } from "../../api/work.ts";
import { ToastProvider } from "../toasts.tsx";
import { BY_ANN, BY_YOU, signIn } from "../user.fixtures.ts";
import { DecisionCard, DecisionInThread } from "./decision-card.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const INITIATIVE_ID = "3f0c2b1a-9d8e-4f7a-8b6c-5d4e3f2a1b0c";
const PLANNING_THREAD = "8a7b6c5d-4e3f-4a1b-9c0d-1e2f3a4b5c6d";
const TASK_THREAD = "9b8c7d6e-5f4a-4b3c-8d2e-1f0a9b8c7d6e";
const CHAT_THREAD = "0c9d8e7f-6a5b-4c4d-9e3f-2a1b0c9d8e7f";

const TASK = { id: "6f1c2b3a-9d8e-4f7a-8b6c-5d4e3f2a1b0c", title: "Export usage as CSV" } as Task;

function aDecision(threadId: string): Decision {
  return {
    id: "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e",
    threadId,
    kind: "form",
    taskId: TASK.id,
    roleKey: "planner",
    questions: [
      {
        kind: "choice",
        question: "Which format?",
        options: ["CSV", "JSON"],
        recommendation: { option: 0, reason: "Spreadsheets open it." },
      },
    ],
    question: "Which format?",
    context: "",
    options: ["CSV", "JSON"],
    recommendation: { option: 0, reason: "Spreadsheets open it." },
    attachmentIds: [],
    askedAt: "2026-11-10T14:02:00.000Z",
    putTo: null,
    passedOn: [],
    formAnswer: null,
    answer: null,
    answeredAt: null,
    answeredByUser: null,
    answeredBy: null,
    atUsersRequest: null,
    answeredByTheOffice: false,
    closedAt: null,
  };
}

function aThread(id: string, home: Thread["home"]): Thread {
  return { id, home, roleKey: "planner", state: "answering", stageThread: false } as Thread;
}

const CONSULTATION_ON_TASK = "3a2b1c0d-9e8f-4a7b-8c6d-5e4f3a2b1c0d";

const PLANNER = { key: "planner", letGoAt: null, card: { name: "Angela" } } as unknown as Role;
const REVIEWER = { key: "reviewer", letGoAt: null, card: { name: "Michael" } } as unknown as Role;

async function rendered(
  decision: Decision,
  view: "in-thread" | "card" = "in-thread",
): Promise<HTMLElement> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  queryClient.setQueryData(roleQueries.list().queryKey, [PLANNER, REVIEWER]);
  signIn(queryClient);
  queryClient.setQueryData(taskQueries.one(TASK.id).queryKey, TASK);
  queryClient.setQueryData(
    threadQueries.one(PLANNING_THREAD).queryKey,
    aThread(PLANNING_THREAD, { kind: "initiative", initiativeId: INITIATIVE_ID }),
  );
  queryClient.setQueryData(
    threadQueries.one(TASK_THREAD).queryKey,
    aThread(TASK_THREAD, { kind: "task", taskId: TASK.id }),
  );
  queryClient.setQueryData(
    threadQueries.one(CHAT_THREAD).queryKey,
    aThread(CHAT_THREAD, { kind: "chat", roleKey: "reviewer" }),
  );
  const consultation = {
    ...aThread(CONSULTATION_ON_TASK, { kind: "task", taskId: TASK.id }),
    roleKey: "reviewer",
    consultation: { decisionId: decision.id, askerThreadId: TASK_THREAD, askerRoleKey: "planner" },
  } as Thread;
  queryClient.setQueryData(threadQueries.one(CONSULTATION_ON_TASK).queryKey, consultation);
  queryClient.setQueryData(threadQueries.onTask(TASK.id).queryKey, [consultation]);
  const rootRoute = createRootRoute({
    component: () =>
      view === "card" ? (
        <DecisionCard decision={decision} personName="Angela" answering={false} followUps />
      ) : (
        <DecisionInThread decision={decision} personName="Angela" />
      ),
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  const page = document.createElement("div");
  document.body.append(page);
  await act(async () => {
    createRoot(page).render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </QueryClientProvider>,
    );
    await router.load();
  });
  return page;
}

describe("a Decision in its Thread", () => {
  afterEach(() => document.body.replaceChildren());

  it("names its Task in an Initiative's planning Thread, leading to its card there", async () => {
    const page = await rendered(aDecision(PLANNING_THREAD));

    const onTask = page.querySelector(".decision-on-task");
    expect(onTask?.textContent).toBe(`On ${TASK.title}`);
    expect(onTask?.querySelector("a")?.getAttribute("href")).toBe(`/tasks/${TASK.id}`);
    const toCard = [...page.querySelectorAll("a")].find(
      (link) => link.textContent === "Answer it in Needs you",
    );
    expect(toCard?.getAttribute("href")).toBe(
      `/tasks/${TASK.id}?decision=1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e`,
    );
  });

  it("names no Task in a Thread on the Task", async () => {
    const page = await rendered(aDecision(TASK_THREAD));

    expect(page.querySelector(".decision-on-task")).toBeNull();
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
  afterEach(() => document.body.replaceChildren());

  it("names the Consultant it was put to, linking to their page", async () => {
    const page = await rendered({ ...aDecision(TASK_THREAD), putTo: "reviewer" });

    expect(headerWords(page)).toBe("Angela to Michael");
    expect(
      [...header(page).querySelectorAll("a.person-tag")].map((tag) => tag.getAttribute("href")),
    ).toEqual(["/people/planner", "/people/reviewer"]);
  });

  it("keeps whom it was put to once answered", async () => {
    const page = await rendered({
      ...aDecision(TASK_THREAD),
      putTo: "reviewer",
      formAnswer: { kind: "submitted", answers: [{ kind: "option", option: 0 }] },
      answer: { kind: "option", option: 0 },
      answeredAt: "2026-11-10T14:30:00.000Z",
      answeredBy: "reviewer",
    });

    expect(headerWords(page)).toBe("Angela to Michael");
  });

  it("links to the Consultation on the Task, beside taking it over", async () => {
    const page = await rendered({ ...aDecision(TASK_THREAD), putTo: "reviewer" });

    const links = [...page.querySelectorAll(".decision-hint a")].map((link) => [
      link.textContent,
      link.getAttribute("href"),
    ]);
    expect(links).toEqual([
      [
        "Take it over in Needs you",
        `/tasks/${TASK.id}?taskThread=${TASK_THREAD}&decision=1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e`,
      ],
      ["Open the Consultation", `/tasks/${TASK.id}?taskThread=${CONSULTATION_ON_TASK}`],
    ]);
  });

  it("names the Role key when the Consultant's Role is gone", async () => {
    const page = await rendered({ ...aDecision(TASK_THREAD), putTo: "designer" });

    expect(headerWords(page)).toBe("Angela to designer");
  });

  it("names no one else when it waits on the user", async () => {
    const page = await rendered(aDecision(TASK_THREAD));

    expect(headerWords(page)).toBe("Angela");
    expect(header(page).querySelector(".decision-put-to")).toBeNull();
  });
});

/** The Decision answered with JSON, as `fields` say who gave it. */
function answered(fields: Partial<Decision> = {}): Decision {
  return {
    ...aDecision(TASK_THREAD),
    formAnswer: { kind: "submitted", answers: [{ kind: "option", option: 1 }] },
    answer: { kind: "option", option: 1 },
    answeredAt: "2026-11-10T14:30:00.000Z",
    ...fields,
  };
}

function answeredLine(page: HTMLElement): HTMLElement {
  const line = page.querySelector<HTMLElement>(".decision-answered");
  if (line === null) throw new Error("The Decision shows no answer.");
  return line;
}

describe("an answered Decision in its Thread", () => {
  afterEach(() => document.body.replaceChildren());

  it("reads as the user's own answer, or the Consultant's", async () => {
    expect(answeredLine(await rendered(answered())).textContent).toBe("Answered: JSON");
    document.body.replaceChildren();
    const byConsultant = await rendered(answered({ putTo: "reviewer", answeredBy: "reviewer" }));
    expect(answeredLine(byConsultant).textContent).toBe("Answered by Michael: JSON");
  });

  it("names the person who answered at the user's request, linking to the chat they were asked in", async () => {
    const page = await rendered(
      answered({ atUsersRequest: { roleKey: "reviewer", threadId: CHAT_THREAD, user: null } }),
    );

    const line = answeredLine(page);
    expect(line.textContent).toBe("Answered by Michael at your request: JSON");
    expect(line.querySelector("a")?.textContent).toBe("at your request");
    expect(line.querySelector("a")?.getAttribute("href")).toBe(
      `/?chat=reviewer&thread=${CHAT_THREAD}`,
    );
  });

  it("names the user who answered: you, or another user by name", async () => {
    const byYou = await rendered(answered({ answeredByUser: BY_YOU }));
    expect(answeredLine(byYou).textContent).toBe("Answered by you: JSON");
    document.body.replaceChildren();

    const byAnn = await rendered(answered({ answeredByUser: BY_ANN }));
    expect(answeredLine(byAnn).textContent).toBe("Answered by Ann Lee: JSON");
  });

  it("names the user at whose request a person answered", async () => {
    const atYours = await rendered(
      answered({ atUsersRequest: { roleKey: "reviewer", threadId: CHAT_THREAD, user: BY_YOU } }),
    );
    expect(answeredLine(atYours).textContent).toBe("Answered by Michael at your request: JSON");
    document.body.replaceChildren();

    const atAnns = await rendered(
      answered({ atUsersRequest: { roleKey: "reviewer", threadId: CHAT_THREAD, user: BY_ANN } }),
    );
    expect(answeredLine(atAnns).textContent).toBe("Answered by Michael at Ann Lee's request: JSON");
  });

  it("links to a Thread on a Task the user asked in on the Task's page", async () => {
    const page = await rendered(
      answered({ atUsersRequest: { roleKey: "reviewer", threadId: TASK_THREAD, user: null } }),
    );

    expect(answeredLine(page).querySelector("a")?.getAttribute("href")).toBe(
      `/tasks/${TASK.id}?taskThread=${TASK_THREAD}`,
    );
  });
});

describe("a closed Decision", () => {
  afterEach(() => document.body.replaceChildren());

  /** Closed unanswered, as its Task was dropped while it waited on a Consultant. */
  const closed: Decision = {
    ...aDecision(TASK_THREAD),
    putTo: "reviewer",
    closedAt: "2026-11-15T09:00:00.000Z",
  };

  it("says its Task was dropped on its card, with nothing to answer or take over", async () => {
    const page = await rendered(closed, "card");

    expect(answeredLine(page).textContent).toBe("Closed: the Task was dropped.");
    expect(page.querySelector(".decision-options")).toBeNull();
    expect(page.querySelector(".decision-free-answer")).toBeNull();
    expect(page.querySelector(".decision-consultation")).toBeNull();
    expect(page.textContent).not.toContain("A question first?");
    expect(page.querySelectorAll("button:not([aria-label='Copy link'])")).toHaveLength(0);
  });

  it("says so in its Thread, no longer waiting on anyone", async () => {
    const page = await rendered(closed);

    expect(answeredLine(page).textContent).toBe("Closed: the Task was dropped.");
    expect(page.textContent).not.toContain("Waiting on");
    expect(page.textContent).not.toContain("Needs you");
    expect(page.textContent).not.toContain("Open the Consultation");
  });
});

describe("a call made from a chat", () => {
  afterEach(() => document.body.replaceChildren());

  const CALLERS_CHAT = "1d0e9f8a-7b6c-4d5e-8f4a-3b2c1d0e9f8a";
  const CONSULTATION = "2e1f0a9b-8c7d-4e6f-9a5b-4c3d2e1f0a9b";
  const call: Decision = {
    ...aDecision(CALLERS_CHAT),
    kind: "request",
    taskId: null,
    questions: [
      {
        kind: "open",
        question: "Set up the Project's commands.",
        why: "Only Michael drafts them.",
      },
    ],
    question: "Set up the Project's commands.",
    options: [],
    recommendation: { option: 0, reason: "Only Michael drafts them." },
    putTo: "reviewer",
  };

  async function renderedInChat(decision: Decision): Promise<HTMLElement> {
    const consultation = {
      ...aThread(CONSULTATION, { kind: "chat", roleKey: "reviewer" }),
      roleKey: "reviewer",
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
    queryClient.setQueryData(
      threadQueries.one(CALLERS_CHAT).queryKey,
      aThread(CALLERS_CHAT, { kind: "chat", roleKey: "planner" }),
    );
    queryClient.setQueryData(threadQueries.one(CONSULTATION).queryKey, consultation);
    queryClient.setQueryData(threadQueries.inChat("reviewer").queryKey, {
      pages: [{ rows: [consultation], next: null, total: 1 }],
      pageParams: [undefined],
    });
    const router = createRouter({
      routeTree: createRootRoute({
        component: () => <DecisionInThread decision={decision} personName="Angela" />,
      }),
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    const page = document.createElement("div");
    document.body.append(page);
    await act(async () => {
      createRoot(page).render(
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <RouterProvider router={router} />
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
      answer: { kind: "free-answer", text: "I drafted a Proposal." },
      answeredAt: "2026-11-12T14:30:00.000Z",
      answeredBy: "reviewer",
    });
    expect(answeredLine(byCallee).textContent).toBe("Answered by Michael: I drafted a Proposal.");
    document.body.replaceChildren();

    const byTheOffice = await renderedInChat({
      ...call,
      formAnswer: {
        kind: "submitted",
        answers: [{ kind: "words", text: "So it is the user's now: ask them in your reply." }],
      },
      answer: { kind: "free-answer", text: "So it is the user's now: ask them in your reply." },
      answeredAt: "2026-11-12T14:30:00.000Z",
      answeredByTheOffice: true,
    });
    expect(answeredLine(byTheOffice).textContent).toBe(
      "Answered by The Office: So it is the user's now: ask them in your reply.",
    );
  });
});
