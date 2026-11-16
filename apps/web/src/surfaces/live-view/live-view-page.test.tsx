import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { LiveAgent, LiveView, Role } from "@the-office/contracts";
import { act, useEffect, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { liveViewEventCacheUpdates } from "../../api/live-view.ts";
import { nowQueries } from "../../api/notifications.ts";
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
import { doingWords, pickedDoingOf } from "./live-states.ts";
import type {
  IdleDoing,
  Light,
  OfficePerson,
  OfficeStage,
  OfficeStageOptions,
} from "./live-view-types.ts";
import { DAY_LIGHT, officePerson } from "./live-view.fixtures.ts";

// jsdom has no layout, so nothing ever resizes; the popover's placing only needs it to exist.
globalThis.ResizeObserver = class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

const stages = vi.hoisted(() => ({
  made: [] as {
    options: OfficeStageOptions;
    applied: (readonly OfficePerson[])[];
    alarms: boolean[];
    lit: { light: Light; now: Date }[];
  }[],
}));

// The browser's time zone, stubbed: a zone with no place (`Etc/UTC`) keeps day light all day.
const zone = vi.hoisted(() => ({ now: "Etc/UTC" as string | null }));
vi.mock("./light.ts", async (original) => ({
  ...(await original<typeof import("./light.ts")>()),
  browserZone: () => zone.now,
}));

// The PixiJS stage never loads in jsdom: a fake one records what the page asks of it.
vi.mock("./office-stage.ts", () => ({
  createOfficeStage: (_canvas: HTMLCanvasElement, options: OfficeStageOptions) => {
    const made = {
      options,
      applied: [] as (readonly OfficePerson[])[],
      alarms: [] as boolean[],
      lit: [] as { light: Light; now: Date }[],
    };
    stages.made.push(made);
    const stage: OfficeStage = {
      apply: (people, _now, alarmOn) => {
        // The page gives the stage its light before anyone is drawn.
        if (made.lit.length === 0) throw new Error("The stage was given no light.");
        made.applied.push(people);
        made.alarms.push(alarmOn);
      },
      setLight: (light, now) => void made.lit.push({ light, now }),
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
  serveOffice(people);
  const opened = await openPage("/live-view", {
    "live-view": ShownLiveView,
    "tasks/$taskId": () => <p>The Task</p>,
  });
  await until(() => expect(stages.made.at(-1)?.applied.at(-1)).toHaveLength(people.length));
  return opened;
}

function serveOffice(people: readonly OfficePerson[]): void {
  stubService({
    "GET /api/live-view": () => ({ status: 200, body: snapshotOf(people) }),
    "GET /api/roles": () => ({ status: 200, body: people.map(roleOf) }),
    "GET /api/tasks": () => ({ status: 200, body: [] }),
    "GET /api/initiatives": () => ({ status: 200, body: [] }),
  });
}

function nothing(): void {}

/** Holds back the service's answers to `request` until the answer it gives is let go. */
function holdBack(request: string): () => void {
  let letGo: () => void = nothing;
  const held = new Promise<void>((resolve) => {
    letGo = resolve;
  });
  const answer = globalThis.fetch;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    if (`${init?.method ?? "GET"} ${String(input)}` === request) await held;
    return answer(input, init);
  });
  return () => letGo();
}

function lastStage() {
  const stage = stages.made.at(-1);
  if (stage === undefined) throw new Error("No stage was made.");
  return stage;
}

/** The stage reports where the figures are, so their nameplates show; `leaving` are walking out. */
function viewOf(
  people: readonly OfficePerson[],
  leaving: readonly string[] = [],
  doings: ReadonlyMap<string, IdleDoing> = new Map(),
): void {
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
        outside: false,
        leaving: leaving.includes(person.roleKey),
      })),
      doings,
    }),
  );
}

/** A nameplate's place, its middle under the figure's feet. */
function transformAt(x: number, bottom: number): string {
  return `translate(${x}px, ${bottom}px) translateX(-50%)`;
}

function nameplateOf(page: HTMLElement, name: string): HTMLElement | null {
  return (
    [...page.querySelectorAll<HTMLElement>(".live-nameplate")].find((plate) =>
      plate.textContent?.includes(name),
    ) ?? null
  );
}

/** The time chip at the floor's top left, by its words. */
function timeChipOf(page: HTMLElement): HTMLElement | null {
  return page.querySelector<HTMLElement>(".live-time-chip");
}

/** What the time chip's tooltip says, as its accessible description. */
function timeChipWords(page: HTMLElement): string | null | undefined {
  const chip = timeChipOf(page);
  return document.getElementById(chip?.getAttribute("aria-describedby") ?? "")?.textContent;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  zone.now = "Etc/UTC";
  closePage();
  stages.made.length = 0;
  queryClient = undefined;
});

/** The fire alarm on Now, as its sounded and all clear events leave it. */
function alarmTo(fireAlarm: unknown): void {
  act(() => {
    (queryClient as QueryClient).setQueryData(nowQueries.now().queryKey, { fireAlarm } as never);
  });
}

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

  it("empties the floor while the fire alarm is on, from the now query, and says so", async () => {
    const { page } = await openLiveView([PAM_IDLE, JIM_WORKING]);
    expect(lastStage().alarms.at(-1)).toBe(false);
    alarmTo({ since: new Date().toISOString(), paused: [] });
    await until(() => expect(lastStage().alarms.at(-1)).toBe(true));
    expect(lastStage().applied.at(-1)).toHaveLength(2);
    expect(page.querySelector("canvas")?.getAttribute("aria-label")).toMatch(
      /^2 people: the fire alarm is on, everyone is out of the office\. Day, /,
    );

    alarmTo(null);
    await until(() => expect(lastStage().alarms.at(-1)).toBe(false));
    expect(page.querySelector("canvas")?.getAttribute("aria-label")).toMatch(
      /^2 people: 1 working, 1 idle\. Day, /,
    );
  });

  it("applies nothing to the stage until the snapshot and the Roles have both loaded", async () => {
    serveOffice([PAM_IDLE, JIM_WORKING]);
    const letSnapshotGo = holdBack("GET /api/live-view");
    const letRolesGo = holdBack("GET /api/roles");
    await openPage("/live-view", { "live-view": ShownLiveView });
    await until(() => expect(stages.made.at(-1)?.lit.length).toBeGreaterThan(0));
    expect(lastStage().applied).toEqual([]);

    letRolesGo();
    // The Roles alone load, and still nothing is applied.
    for (let tick = 0; tick < 5; tick++) await until(() => undefined);
    expect(lastStage().applied).toEqual([]);

    letSnapshotGo();
    await until(() => expect(lastStage().applied.length).toBeGreaterThan(0));
    // The first `apply` lays the floor out with the whole office, nobody walking in as a hire.
    expect(lastStage().applied[0]?.map(({ roleKey }) => roleKey)).toEqual([
      "office-manager",
      "developer",
    ]);
  });

  it("applies an office with nobody in it, once loaded, as nobody", async () => {
    await openLiveView([]);
    expect(lastStage().applied[0]).toEqual([]);
  });

  it("says what someone idle is doing, as the stage reports it", async () => {
    const { page } = await openLiveView([PAM_IDLE, JIM_WORKING]);
    act(() => buttonNamed(page, "List")?.click());
    // Before the stage reports, what they picked for this turn.
    const picked = pickedDoingOf(PAM_IDLE, new Date(), DAY_LIGHT);
    const idleGroup = () => page.querySelector("[aria-label='Idle']");
    expect(shownText(idleGroup()!)).toContain(`Idle: ${doingWords(picked)}`);

    viewOf(
      [PAM_IDLE, JIM_WORKING],
      [],
      new Map([["office-manager", { pastime: "exercise", exercise: "push-ups", chatting: false }]]),
    );

    expect(shownText(idleGroup()!)).toContain("Idle: doing push-ups");
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

  it("moves a nameplate with its walking figure, hidden while the figure is outside", async () => {
    const { page } = await openLiveView([PAM_IDLE, JIM_WORKING]);
    viewOf([PAM_IDLE, JIM_WORKING]);
    const plate = nameplateOf(page, "Jim");
    expect(plate?.style.transform).toBe(transformAt(200, 90));

    lastStage().options.onFigureMove("developer", 150, 120, false);
    expect(plate?.style.transform).toBe(transformAt(150, 120));
    expect(plate?.style.visibility).toBe("");

    lastStage().options.onFigureMove("developer", 10, 60, true);
    expect(plate?.style.visibility).toBe("hidden");
  });

  it("keeps the name of someone let go on their way out, with nothing to open", async () => {
    const { page } = await openLiveView([PAM_IDLE, JIM_WORKING]);
    viewOf([PAM_IDLE, JIM_WORKING]);

    act(() =>
      liveViewEventCacheUpdates["live-view.changed"]?.(
        {
          type: "live-view.changed",
          occurredAt: new Date().toISOString(),
          liveView: snapshotOf([PAM_IDLE]),
        } as never,
        queryClient as QueryClient,
      ),
    );
    await until(() => expect(lastStage().applied.at(-1)).toHaveLength(1));
    viewOf([PAM_IDLE, JIM_WORKING], ["developer"]);

    const plate = nameplateOf(page, "Jim");
    expect(plate?.hasAttribute("inert")).toBe(true);
    expect(buttonNamed(page, "Jim")).toBeUndefined();
  });

  it("says the time of day and where the sun is worked out from in the time chip", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-16T11:00:00.000Z"));
    zone.now = "Europe/Warsaw";

    const { page } = await openLiveView([JIM_WORKING]);

    expect(timeChipOf(page)?.getAttribute("aria-label")).toBe("Day, 12:00");
    expect(timeChipWords(page)).toMatch(
      /^Sunrise 0\d:\d\d, sunset 1\d:\d\d in Europe\/Warsaw, worked out from this browser's time zone\. At night idle people have gone home\.$/,
    );
    expect(page.querySelector("canvas")?.getAttribute("aria-label")).toMatch(/\. Day, 12:00\.$/);
  });

  it("says day light all day for a time zone with no place to work the sun out from", async () => {
    const { page } = await openLiveView([JIM_WORKING]);

    expect(timeChipWords(page)).toBe(
      "Day light all day: this browser's time zone (Etc/UTC) has no place to work the sun out from.",
    );
  });

  it("says when the sun neither rises nor sets today", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-12-21T18:00:00.000Z"));
    zone.now = "America/Resolute";

    const { page } = await openLiveView([JIM_WORKING]);

    expect(timeChipWords(page)).toBe("No sunrise or sunset today in America/Resolute.");
  });

  it("shows the time chip's words in a popover at a tap on a screen without hover", async () => {
    const matchMedia = window.matchMedia;
    vi.stubGlobal("matchMedia", (query: string) => ({
      ...matchMedia(query),
      matches: query === "(hover: none)",
    }));
    vi.useFakeTimers({ toFake: ["Date"] });
    // Noon on this machine's clock, as a zone with no place keeps the browser's own hours.
    vi.setSystemTime(new Date(2026, 10, 16, 12, 0));

    const { page } = await openLiveView([JIM_WORKING]);
    act(() => buttonNamed(page, "Day, 12:00")?.click());

    const popover = document.querySelector("[role='dialog'][aria-label='Day, 12:00']");
    expect(popover?.textContent).toBe(
      "Day light all day: this browser's time zone (Etc/UTC) has no place to work the sun out from.",
    );
  });

  it("lists an idle person under Gone home at night, with no nameplate on the floor", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-16T21:30:00.000Z"));
    zone.now = "Europe/Warsaw";
    const pamIdle = officePerson("office-manager", { idleSince: "2026-11-16T15:00:00.000Z" });

    const { page } = await openLiveView([pamIdle, JIM_WORKING]);
    viewOf([pamIdle, JIM_WORKING]);

    expect(timeChipOf(page)?.getAttribute("aria-label")).toBe("Night, 22:30");
    expect(page.querySelector("canvas")?.getAttribute("aria-label")).toBe(
      "2 people: 1 working, 1 gone home. Night, 22:30.",
    );
    expect(nameplateOf(page, "Pam")).toBeNull();
    expect(nameplateOf(page, "Jim")).not.toBeNull();

    act(() => buttonNamed(page, "List")?.click());

    const goneHome = page.querySelector("[aria-label='Gone home']");
    expect(goneHome && shownText(goneHome)).toContain("Gone home for the night: idle");
    expect(goneHome && shownText(goneHome)).toContain("Chat with Pam");
    expect(
      buttonNamed(page, "Pam has gone home, so isn't on the floor")?.hasAttribute("disabled"),
    ).toBe(true);
  });

  it("gives the stage the light again each minute", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date("2026-11-16T11:00:00.000Z"));
    zone.now = "Europe/Warsaw";

    await openLiveView([JIM_WORKING]);
    const lit = lastStage().lit.length;
    expect(lastStage().lit.at(-1)?.light.minutes).toBe(12 * 60);

    act(() => vi.advanceTimersByTime(60_000));

    expect(lastStage().lit.length).toBe(lit + 1);
    expect(lastStage().lit.at(-1)?.light.minutes).toBe(12 * 60 + 1);
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
