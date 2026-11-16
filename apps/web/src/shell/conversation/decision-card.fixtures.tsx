import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import type {
  Attachment,
  Decision,
  DecisionQuestion,
  Role,
  Task,
  Thread,
} from "@the-office/contracts";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { threadQueries } from "../../api/conversations.ts";
import { roleQueries } from "../../api/people.ts";
import { attachmentQueries, taskQueries } from "../../api/work.ts";
import { ToastProvider } from "../toasts.tsx";
import { signIn } from "../user.fixtures.ts";
import { DecisionDraftsProvider } from "./decision-drafts.tsx";

/** What the Decision cards' tests share: the Decisions, their Threads, and a page to show them on. */

export const INITIATIVE_ID = "3f0c2b1a-9d8e-4f7a-8b6c-5d4e3f2a1b0c";
export const PLANNING_THREAD = "8a7b6c5d-4e3f-4a1b-9c0d-1e2f3a4b5c6d";
export const TASK_THREAD = "9b8c7d6e-5f4a-4b3c-8d2e-1f0a9b8c7d6e";
export const CHAT_THREAD = "0c9d8e7f-6a5b-4c4d-9e3f-2a1b0c9d8e7f";
export const CONSULTATION_ON_TASK = "3a2b1c0d-9e8f-4a7b-8c6d-5e4f3a2b1c0d";
export const DECISION_ID = "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e";

export const TASK = {
  id: "6f1c2b3a-9d8e-4f7a-8b6c-5d4e3f2a1b0c",
  title: "Export usage as CSV",
} as Task;

export const PLANNER = {
  key: "planner",
  letGoAt: null,
  card: { name: "Angela" },
} as unknown as Role;
export const REVIEWER = {
  key: "reviewer",
  letGoAt: null,
  card: { name: "Michael" },
} as unknown as Role;

export const FORMAT: DecisionQuestion = {
  kind: "choice",
  question: "Which format?",
  options: ["CSV", "JSON"],
  recommendation: { option: 0, reason: "Spreadsheets open it." },
};
export const FILE_NAME: DecisionQuestion = { kind: "open", question: "What is the file called?" };
export const COLUMNS: DecisionQuestion = {
  kind: "choice",
  question: "Which columns?",
  options: ["All", "Only totals"],
  recommendation: { option: 1, reason: "Totals are what people read." },
};

export function aDecision(fields: Partial<Decision> = {}): Decision {
  return {
    id: DECISION_ID,
    threadId: TASK_THREAD,
    kind: "form",
    taskId: TASK.id,
    roleKey: "planner",
    questions: [FORMAT],
    context: "",
    attachmentIds: [],
    askedAt: "2026-11-10T14:02:00.000Z",
    putTo: null,
    passedOn: [],
    formAnswer: null,
    answeredAt: null,
    answeredByUser: null,
    answeredBy: null,
    atUsersRequest: null,
    answeredByTheOffice: false,
    closedAt: null,
    ...fields,
  };
}

function aThread(id: string, home: Thread["home"], state: Thread["state"]): Thread {
  return { id, home, roleKey: "planner", state, stageThread: false } as Thread;
}

/** Shows `view` on a page with every Thread a Decision here is asked in. */
export async function rendered(
  view: () => ReactNode,
  {
    threadState = "waiting",
    attachments = [],
    decisionId = DECISION_ID,
  }: {
    readonly threadState?: Thread["state"];
    readonly attachments?: readonly Attachment[];
    readonly decisionId?: string;
  } = {},
): Promise<HTMLElement> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  queryClient.setQueryData(roleQueries.list().queryKey, [PLANNER, REVIEWER]);
  signIn(queryClient);
  queryClient.setQueryData(taskQueries.one(TASK.id).queryKey, TASK);
  queryClient.setQueryData(
    attachmentQueries.of({ kind: "task", taskId: TASK.id }).queryKey,
    attachments as Attachment[],
  );
  queryClient.setQueryData(
    threadQueries.one(PLANNING_THREAD).queryKey,
    aThread(PLANNING_THREAD, { kind: "initiative", initiativeId: INITIATIVE_ID }, threadState),
  );
  queryClient.setQueryData(
    threadQueries.one(TASK_THREAD).queryKey,
    aThread(TASK_THREAD, { kind: "task", taskId: TASK.id }, threadState),
  );
  queryClient.setQueryData(
    threadQueries.one(CHAT_THREAD).queryKey,
    aThread(CHAT_THREAD, { kind: "chat", roleKey: "reviewer" }, threadState),
  );
  const consultation = {
    ...aThread(CONSULTATION_ON_TASK, { kind: "task", taskId: TASK.id }, "waiting"),
    roleKey: "reviewer",
    consultation: { decisionId, askerThreadId: TASK_THREAD, askerRoleKey: "planner" },
  } as Thread;
  queryClient.setQueryData(threadQueries.one(CONSULTATION_ON_TASK).queryKey, consultation);
  queryClient.setQueryData(threadQueries.onTask(TASK.id).queryKey, [consultation]);
  const router = createRouter({
    routeTree: createRootRoute({ component: view }),
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

/** The buttons named `name` anywhere on the page, a window's too. */
export function buttonsNamed(name: string): HTMLButtonElement[] {
  return [...document.body.querySelectorAll<HTMLButtonElement>("button")].filter((button) =>
    isNamed(button, name),
  );
}

/** A button's name: its label, or its words, leaving out the design system's inline `<style>`. */
export function buttonName(button: HTMLButtonElement): string {
  return (
    button.getAttribute("aria-label") ??
    [...button.childNodes]
      .filter((node) => node.nodeName !== "STYLE")
      .map((node) => node.textContent)
      .join("")
      .trim()
  );
}

function isNamed(button: HTMLButtonElement, name: string): boolean {
  return buttonName(button) === name;
}

/** The one button named `name`. */
export function buttonNamed(name: string, within: ParentNode = document.body): HTMLButtonElement {
  const found = [...within.querySelectorAll<HTMLButtonElement>("button")].filter((button) =>
    isNamed(button, name),
  );
  if (found.length !== 1) throw new Error(`${found.length} buttons named "${name}".`);
  return found[0]!;
}

/** The fields labelled `label`, its required mark left out. */
export function fieldsLabelled(
  label: string,
  within: ParentNode = document.body,
): HTMLTextAreaElement[] {
  return [...within.querySelectorAll("label")]
    .filter((shown) => shown.textContent?.replace(/\*$/, "") === label)
    .map((shown) => document.getElementById(shown.htmlFor))
    .filter((field): field is HTMLTextAreaElement => field instanceof HTMLTextAreaElement);
}

export function fieldLabelled(
  label: string,
  within: ParentNode = document.body,
): HTMLTextAreaElement {
  const [field, ...more] = fieldsLabelled(label, within);
  if (field === undefined || more.length > 0) {
    throw new Error(`${more.length + (field ? 1 : 0)} fields labelled "${label}".`);
  }
  return field;
}

export function type(field: HTMLTextAreaElement, text: string): void {
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  act(() => {
    setValue?.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

export async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.click();
    await Promise.resolve();
  });
}

/** The radio of `option` in the choice named `question`. */
export function radio(
  question: string,
  option: string,
  within: ParentNode = document.body,
): HTMLInputElement {
  const group = [...within.querySelectorAll("[role='radiogroup']")].find(
    (shown) => shown.getAttribute("aria-label") === question,
  );
  const line = [...(group?.querySelectorAll("label") ?? [])].find((shown) =>
    shown.textContent?.startsWith(option),
  );
  const input = line?.querySelector("input");
  if (!input) throw new Error(`No option "${option}" in "${question}".`);
  return input;
}

/** Lets the mutation settle and React show what it changed. */
export async function settle(): Promise<void> {
  await act(async () => {
    for (let turn = 0; turn < 5; turn += 1) await new Promise((done) => setTimeout(done, 0));
  });
}
