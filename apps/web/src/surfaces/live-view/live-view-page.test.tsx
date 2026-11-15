import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { LiveAgent, LiveView, Role } from "@the-office/contracts";
import { act, useEffect, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { liveViewEventCacheUpdates } from "../../api/live-view.ts";
import {
  buttonNamed,
  closePage,
  openPage,
  shownText,
  stubService,
  until,
} from "../../shell/page.fixtures.tsx";
import { PageHeadingProvider } from "../../shell/page-heading.tsx";
import { LiveViewPage } from "./live-view-page.tsx";
import type { OfficePerson, OfficeStage, OfficeStageOptions } from "./live-view-types.ts";
import { officePerson } from "./live-view.fixtures.ts";

// jsdom has no layout, so nothing ever resizes; the popover's placing only needs it to exist.
globalThis.ResizeObserver = class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

const stages = vi.hoisted(() => ({
  made: [] as { options: OfficeStageOptions; applied: (readonly OfficePerson[])[] }[],
}));

// The PixiJS stage never loads in jsdom: a fake one records what the page asks of it.
vi.mock("./office-stage.ts", () => ({
  createOfficeStage: (_canvas: HTMLCanvasElement, options: OfficeStageOptions) => {
    const made = { options, applied: [] as (readonly OfficePerson[])[] };
    stages.made.push(made);
    const stage: OfficeStage = {
      apply: (people) => void made.applied.push(people),
      frame: () => undefined,
      zoomStep: () => undefined,
      fit: () => undefined,
      resize: () => undefined,
      destroy: () => undefined,
    };
    return Promise.resolve(stage);
  },
}));

const TASK_ID = "3f2a1b0c-4d5e-4f6a-8b7c-9d0e1f2a3b4c";
const STAGE_THREAD = "6a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const CHAT_THREAD = "7b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e";

function agentOnTheTask(threadId: string): LiveAgent {
  return { threadId, home: { kind: "task", taskId: TASK_ID }, kind: "stage", consultation: null };
}

const JIM_WORKING = officePerson("developer", {
  state: "working",
  agents: [agentOnTheTask(STAGE_THREAD)],
});
const PAM_IDLE = officePerson("office-manager", { idleSince: new Date().toISOString() });

function roleOf(person: OfficePerson): Role {
  return {
    key: person.roleKey,
    card: {
      name: person.name,
      title: person.title,
      responsibilities: "",
      instructions: "",
      roleOverride: null,
      effort: "medium",
      capabilities: {
        sharedMemory: false,
        chat: person.chat,
        consultant: person.consultant,
        runEnvironment: false,
      },
      permissionProfile: { edit: false, run: "read-only-git", web: false, mcpTools: {} },
      hardSwitches: {
        runInstalls: { kind: "ask-me" },
        publishOutsideThePipeline: { kind: "ask-me" },
        changeRoles: { kind: "never" },
      },
      taskLimit: person.taskLimit,
      sessionDefault: "context-policy",
      skills: [],
    },
    cardVersion: 1,
    hiredAt: person.hiredAt,
    cardSavedAt: person.hiredAt,
    letGoAt: null,
    avatar: null,
    builtIn: false,
    askingYouUntilHired: [],
    mcpServers: [],
  };
}

function snapshotOf(people: readonly OfficePerson[]): LiveView {
  return { people: [...people] };
}

let queryClient: QueryClient | undefined;

function ShownLiveView(): ReactNode {
  const client = useQueryClient();
  useEffect(() => {
    queryClient = client;
  }, [client]);
  return (
    <PageHeadingProvider setPageHeading={() => undefined}>
      <LiveViewPage />
    </PageHeadingProvider>
  );
}

async function openLiveView(people: readonly OfficePerson[]) {
  stubService({
    "GET /api/live-view": () => ({ status: 200, body: snapshotOf(people) }),
    "GET /api/roles": () => ({ status: 200, body: people.map(roleOf) }),
    "GET /api/tasks": () => ({ status: 200, body: [] }),
    "GET /api/initiatives": () => ({ status: 200, body: [] }),
  });
  const opened = await openPage("/live-view", {
    "live-view": ShownLiveView,
    "tasks/$taskId": () => <p>The Task</p>,
  });
  await until(() => expect(stages.made.at(-1)?.applied.at(-1)).toHaveLength(people.length));
  return opened;
}

function lastStage() {
  const stage = stages.made.at(-1);
  if (stage === undefined) throw new Error("No stage was made.");
  return stage;
}

/** The stage reports where the figures are, so their nameplates show. */
function viewOf(people: readonly OfficePerson[]): void {
  act(() =>
    lastStage().options.onView({
      scale: 3,
      zoomPercent: 300,
      canZoomIn: true,
      canZoomOut: true,
      anchors: people.map((person, index) => ({
        roleKey: person.roleKey,
        x: 100 * (index + 1),
        top: 40,
        bottom: 90,
      })),
    }),
  );
}

afterEach(() => {
  closePage();
  stages.made.length = 0;
  queryClient = undefined;
});

describe("The Live view", () => {
  it("labels the floor with its summary and lists everyone by what they are doing", async () => {
    const { page } = await openLiveView([PAM_IDLE, JIM_WORKING]);

    const floor = page.querySelector("canvas");
    expect(floor?.getAttribute("role")).toBe("img");
    expect(floor?.getAttribute("aria-label")).toMatch(/^2 people: 1 working, 1 idle\. Day, /);
    expect(
      document.getElementById(floor?.getAttribute("aria-describedby") ?? "")?.textContent,
    ).toContain("arrow keys");

    act(() => buttonNamed(page, "List")?.click());

    const working = page.querySelector("[aria-label='Working']");
    expect(working && shownText(working)).toContain("Working on a Stage of a Task");
    const idle = page.querySelector("[aria-label='Idle']");
    expect(idle && shownText(idle)).toContain("Chat with Pam");
  });

  it("draws the snapshot a live-view.changed event brings in place of the last", async () => {
    const { page } = await openLiveView([PAM_IDLE, JIM_WORKING]);
    const jimIdle = officePerson("developer", { idleSince: new Date().toISOString() });

    act(() =>
      liveViewEventCacheUpdates["live-view.changed"]?.(
        {
          type: "live-view.changed",
          occurredAt: new Date().toISOString(),
          liveView: snapshotOf([PAM_IDLE, jimIdle]),
        } as never,
        queryClient as QueryClient,
      ),
    );

    await until(() =>
      expect(page.querySelector("canvas")?.getAttribute("aria-label")).toMatch(
        /^2 people: 2 idle\./,
      ),
    );
    expect(
      lastStage()
        .applied.at(-1)
        ?.map(({ state }) => state),
    ).toEqual(["idle", "idle"]);
  });

  it("opens someone's one piece of work at a press on them", async () => {
    const { router } = await openLiveView([PAM_IDLE, JIM_WORKING]);

    act(() => lastStage().options.onPress("developer", "mouse"));

    await until(() => expect(router.state.location.pathname).toBe(`/tasks/${TASK_ID}`));
    expect(router.state.location.search).toEqual({ taskThread: STAGE_THREAD });
  });

  it("offers each piece of work in a popover when they have several", async () => {
    const busy = officePerson("developer", {
      state: "working",
      agents: [
        agentOnTheTask(STAGE_THREAD),
        {
          threadId: CHAT_THREAD,
          home: { kind: "chat", roleKey: "developer" },
          kind: "thread",
          consultation: null,
        },
      ],
    });
    const { page } = await openLiveView([busy]);
    viewOf([busy]);

    act(() => lastStage().options.onPress("developer", "mouse"));

    const popover = document.querySelector("[role='dialog'][aria-label='Jim']");
    expect(popover && shownText(popover)).toContain("A Stage of a Task");
    expect(popover && shownText(popover)).toContain("A chat");
    expect(buttonNamed(page, "Jim")?.getAttribute("aria-expanded")).toBe("true");
  });

  it("draws the still office when the system asks for reduced motion", async () => {
    const matchMedia = window.matchMedia;
    vi.stubGlobal("matchMedia", (query: string) => ({
      ...matchMedia(query),
      matches: query === "(prefers-reduced-motion: reduce)",
    }));

    await openLiveView([PAM_IDLE]);

    expect(lastStage().options.reducedMotion).toBe(true);
  });
});
