import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import type {
  NewProjectPipeline,
  Pipeline,
  Project,
  ProjectPipeline,
  Role,
} from "@the-office/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dutyQueries, roleQueries } from "../../../api/people.ts";
import { ChatProvider } from "../../../shell/chat/use-chat.tsx";
import { ThreadDraftsProvider } from "../../../shell/conversation/thread-drafts.tsx";
import { aDuty } from "../../../shell/duties.fixtures.ts";
import { ToastProvider } from "../../../shell/toasts.tsx";
import { AddProjectPipelineDialog } from "./add-project-pipeline-dialog.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function pipeline(id: string, name: string): Pipeline {
  return {
    id,
    name,
    description: "",
    stages: [{ name: "Implement" }, { name: "Tests" }],
  } as unknown as Pipeline;
}

const FULL = pipeline("full", "Full");
const ONBOARD = pipeline("onboard", "Onboard");
const LINUX_CHECK = {
  ...pipeline("linux-check", "Full with Linux check"),
  projectId: "the-office",
  copiedFrom: { name: "Full", at: "2026-11-12T10:00:00.000Z" },
  brokenBeforeUpdate: null,
} as unknown as ProjectPipeline;

const PROJECT = { id: "the-office", name: "the-office" } as unknown as Project;

const DEVOPS = {
  key: "devops",
  letGoAt: null,
  card: { name: "Nina", capabilities: { chat: true } },
} as unknown as Role;

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

/** Answers a copy with the Pipeline added, keeping what it was sent. */
function serving(): { copied?: NewProjectPipeline } {
  const sent: { copied?: NewProjectPipeline } = {};
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>((_input, init) => {
      if (init?.method === "POST") {
        sent.copied = JSON.parse(String(init.body)) as NewProjectPipeline;
        return Promise.resolve(
          Response.json({ ...LINUX_CHECK, id: "copy", name: sent.copied.name }, { status: 201 }),
        );
      }
      return Promise.resolve(Response.json([]));
    }),
  );
  return sent;
}

async function opened(): Promise<void> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  queryClient.setQueryData(roleQueries.list().queryKey, [DEVOPS]);
  queryClient.setQueryData(dutyQueries.list().queryKey, [aDuty("onboards-projects", "devops")]);
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => (
        <ThreadDraftsProvider>
          <ChatProvider>
            <ToastProvider>
              <AddProjectPipelineDialog
                project={PROJECT}
                officeWide={[ONBOARD, FULL]}
                projectPipelines={[LINUX_CHECK]}
                onClose={() => {}}
              />
            </ToastProvider>
          </ChatProvider>
        </ThreadDraftsProvider>
      ),
    }),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  const page = document.createElement("div");
  document.body.append(page);
  await act(async () => {
    createRoot(page).render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    await router.load();
  });
}

function radios(): HTMLInputElement[] {
  return [...document.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
}

function nameField(): HTMLInputElement {
  const field = [...document.querySelectorAll<HTMLInputElement>("input:not([type=radio])")][0];
  if (!field) throw new Error("No Name field.");
  return field;
}

/** A button's words: the design system's Button holds a <style>, whose text isn't its label. */
function buttonNamed(label: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll("button")].find(
    (button) =>
      [...button.childNodes]
        .filter(({ nodeName }) => nodeName !== "STYLE")
        .map(({ textContent }) => textContent)
        .join("") === label,
  );
}

function typed(field: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype = Object.getPrototypeOf(field) as object;
  act(() => {
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("the Copy a Pipeline window", () => {
  it("offers the office-wide Pipelines but Onboard, then the Project's own", async () => {
    serving();
    await opened();

    expect(
      [...document.querySelectorAll(".copy-choices-label")].map(({ textContent }) => textContent),
    ).toEqual(["Office-wide Pipelines", "the-office's Pipelines"]);
    expect(radios().map(({ value }) => value)).toEqual(["full", "linux-check"]);
  });

  it("names the copy after the one picked until the user types a name", async () => {
    serving();
    await opened();

    expect(nameField().value).toBe("Full for the-office");
    act(() => radios()[1]?.click());
    expect(nameField().value).toBe("Full with Linux check for the-office");
    typed(nameField(), "Linux");
    act(() => radios()[0]?.click());
    expect(nameField().value).toBe("Linux");
  });

  it("copies the one picked with its name and description, or asks Devops instead", async () => {
    const sent = serving();
    await opened();
    const description = document.querySelector("textarea");
    if (!description) throw new Error("No Description field.");
    typed(description, "Checks on Linux too.");

    expect(buttonNamed("Ask Nina instead")).toBeDefined();
    await act(async () => buttonNamed("Copy into the-office")?.click());

    expect(sent.copied).toEqual({
      projectId: "the-office",
      copyOf: "full",
      name: "Full for the-office",
      description: "Checks on Linux too.",
    });
  });
});
