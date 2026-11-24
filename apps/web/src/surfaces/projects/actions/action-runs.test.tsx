import type { Action, ActionRun, ActionRunSourceTip } from "@the-office/contracts";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buttonNamed,
  closePage,
  openPage,
  shownText,
  stubService,
  until,
  type Answers,
} from "../../../shell/page.fixtures.tsx";
import { aRun, BUILD, INSTALL, RELEASE, uuid } from "./actions.fixtures.ts";
import { ProjectActionsSection } from "./project-actions-section.tsx";

vi.mock("../../../shell/ask-devops.tsx", () => ({
  useDevops: () => undefined,
  AskDevopsButton: () => null,
}));
vi.mock("../../../shell/use-user-name.ts", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useSignedInUserId: () => "u1",
}));
vi.mock("../project-page.tsx", async () => {
  const { PROJECT } = await import("./actions.fixtures.ts");
  return { useOpenProject: () => PROJECT };
});

const NOW = new Date("2026-11-24T10:20:00.000Z");
const ACTIONS_PATH = "/api/projects/admin-panel/actions";
const MAIN_TIP = "GET /api/projects/admin-panel/actions/source?kind=branch&branch=main";
const TIP: ActionRunSourceTip = {
  kind: "tip",
  branch: "main",
  commit: "f00ba1200000000000000000000000000000000",
  subject: "Fix the login",
};
const MOVED_TIP: ActionRunSourceTip = {
  kind: "tip",
  branch: "main",
  commit: "0badc0d00000000000000000000000000000000",
  subject: "Bump the version",
};

const ok = (body: unknown) => () => ({ status: 200, body });

/** The Actions, each with its runs newest first, and whatever else the test answers. */
function serving(
  actions: readonly Action[],
  runs: Readonly<Record<string, readonly ActionRun[]>>,
  more: Answers = {},
): ReturnType<typeof stubService> {
  return stubService({
    [`GET ${ACTIONS_PATH}`]: ok({ actions }),
    [`PUT ${ACTIONS_PATH}`]: (body) => ({
      status: 200,
      body: {
        actions: (body as { actions: Action[] }).actions.map((action) => ({
          ...action,
          setBy: {},
        })),
      },
    }),
    [`GET ${ACTIONS_PATH}/runs`]: ok({
      actions: Object.entries(runs).map(([actionKey, each]) => ({ actionKey, runs: each })),
    }),
    "GET /api/projects/admin-panel/test-targets": ok({ targets: [] }),
    "GET /api/projects/admin-panel/workflows?ref=main": ok({
      ref: "main",
      problem: null,
      workflows: [],
    }),
    [MAIN_TIP]: ok(TIP),
    ...more,
  });
}

async function opened(path = "/projects/admin-panel/actions"): Promise<HTMLElement> {
  const { page } = await openPage(path, {
    "/projects/$projectId/actions": ProjectActionsSection,
    "/projects/$projectId/actions/$actionKey": ProjectActionsSection,
  });
  await until(() => expect(page.textContent).toContain("Admin panel's Actions"));
  return page;
}

function rowOf(page: HTMLElement, name: string): HTMLElement {
  const row = [...page.querySelectorAll<HTMLElement>(".pick-list-row")].find((each) =>
    each.textContent.includes(name),
  );
  if (!row) throw new Error(`No row ${name}`);
  return row;
}

function press(button: HTMLButtonElement | undefined): void {
  if (!button) throw new Error("No such button");
  act(() => button.click());
}

function dialogNamed(title: string): HTMLElement {
  const found = [...document.querySelectorAll<HTMLElement>("[role=dialog]")].find((each) =>
    shownText(each).startsWith(title),
  );
  if (!found) throw new Error(`No window ${title}`);
  return found;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  closePage();
  vi.useRealTimers();
});

describe("an Action's last run on the Actions list", () => {
  it("shows each last run's state, what it ran from and when, or Not run yet", async () => {
    const workflowRun = aRun(uuid(3), {
      actionKey: RELEASE.key,
      status: { kind: "workflow", state: "running" },
      outcome: null,
      endedAt: null,
    });
    serving([BUILD, INSTALL, RELEASE], {
      [BUILD.key]: [
        aRun(uuid(1), {
          status: { kind: "project-command", state: "failed" },
          outcome: "failed",
          endedBecause: "The command ended with exit code 1.",
        }),
        aRun(uuid(2)),
      ],
      [RELEASE.key]: [workflowRun],
    });
    const page = await opened();

    await until(() => expect(shownText(rowOf(page, "Build it"))).toContain("Failed"));
    const build = rowOf(page, "Build it");
    expect(build.querySelector("[title='The command ended with exit code 1.']")).not.toBeNull();
    expect(shownText(build)).toContain("main · f00ba12 · 20 min ago");
    expect(shownText(rowOf(page, "Install on my phone"))).toContain("Not run yet");
    // A Workflow run's CI run status, as Work › CI shows it.
    expect(shownText(rowOf(page, "Release"))).toContain("Running");
    expect(buttonNamed(rowOf(page, "Release"), "Run Release")?.disabled).toBe(true);
    expect(
      rowOf(page, "Release").querySelector(
        "[title='Release is running already, started by you 20 min ago.']",
      ),
    ).not.toBeNull();
    expect(buttonNamed(build, "Run Build it")?.disabled).toBe(false);
  });

  it("asks before removing a running Action, then removes it", async () => {
    const sent = serving([BUILD, RELEASE], {
      [BUILD.key]: [
        aRun(uuid(1), {
          status: { kind: "project-command", state: "running" },
          outcome: null,
          endedAt: null,
        }),
      ],
    });
    const page = await opened();
    await until(() => expect(shownText(rowOf(page, "Build it"))).toContain("Running"));

    press(buttonNamed(rowOf(page, "Build it"), "Remove Build it"));
    expect(document.body.textContent).toContain(
      "Remove Build it? Its running run stops first. Its runs and their logs are removed with it.",
    );
    expect(sent.some(({ request }) => request === `PUT ${ACTIONS_PATH}`)).toBe(false);

    press(buttonNamed(dialogNamed("Remove Build it"), "Remove"));
    await until(() => expect(document.body.textContent).toContain("Build it removed."));
    const put = sent.find(({ request }) => request === `PUT ${ACTIONS_PATH}`);
    const removed = put?.body as { actions: Action[] } | undefined;
    expect(removed?.actions.map(({ key }) => key)).toEqual(["release"]);
  });
});

describe("the Run window", () => {
  it("runs from the base branch, reading its tip, and toasts the start", async () => {
    const sent = serving(
      [BUILD],
      {},
      {
        [`POST ${ACTIONS_PATH}/build-it/runs`]: () => ({
          status: 200,
          body: aRun(uuid(5), { outcome: null, endedAt: null }),
        }),
      },
    );
    const page = await opened();

    press(buttonNamed(rowOf(page, "Build it"), "Run Build it"));
    const window = dialogNamed("Run Build it");
    await until(() => expect(shownText(window)).toContain("f00ba12 Fix the login"));
    expect(shownText(window)).toContain("Runs build (after install, gone)");

    press(buttonNamed(window, "Run"));
    await until(() => expect(document.body.textContent).toContain("Build it started on main."));
    const post = sent.find(({ request }) => request === `POST ${ACTIONS_PATH}/build-it/runs`);
    expect(post?.body).toEqual({ source: { kind: "branch", branch: "main" } });
    expect(document.querySelector("[role=dialog]")).toBeNull();
  });

  it("keeps a refusal in the window in the service's words", async () => {
    serving(
      [BUILD],
      {},
      {
        [`POST ${ACTIONS_PATH}/build-it/runs`]: () => ({
          status: 409,
          body: { message: "2 Actions are running, as many as Actions at once allows." },
        }),
      },
    );
    const page = await opened();

    press(buttonNamed(rowOf(page, "Build it"), "Run Build it"));
    press(buttonNamed(dialogNamed("Run Build it"), "Run"));

    await until(() => expect(document.body.textContent).toContain("The Action didn't start"));
    expect(document.body.textContent).toContain(
      "2 Actions are running, as many as Actions at once allows.",
    );
    expect(dialogNamed("Run Build it")).toBeDefined();
  });

  it("confirms an Action that leaves the workstation at the base branch's tip, reading it again when it moved", async () => {
    let tip = TIP;
    const release: Action = {
      ...RELEASE,
      settings: { file: "release.yml", inputs: { dry_run: "false" } },
    };
    const sent = serving(
      [release],
      {},
      {
        [MAIN_TIP]: () => ({ status: 200, body: tip }),
        [`POST ${ACTIONS_PATH}/release/runs`]: (body) => {
          if ((body as { commit?: string }).commit === TIP.commit) {
            tip = MOVED_TIP;
            return {
              status: 409,
              body: {
                message: "main moved to 0badc0d since you looked. Run it again to run that commit.",
              },
            };
          }
          return {
            status: 200,
            body: aRun(uuid(6), { actionKey: "release", actionName: "Release" }),
          };
        },
      },
    );
    const page = await opened();

    press(buttonNamed(rowOf(page, "Release"), "Run Release"));
    const window = dialogNamed("Run Release");
    await until(() => expect(buttonNamed(window, "Run Release on main at f00ba12")).toBeDefined());
    expect(shownText(window)).toContain("It leaves the workstation, so it runs from main only.");
    expect(shownText(window)).toContain(
      "Run Release on main at f00ba12 (Fix the login)? What it pushes, publishes, deploys or releases reaches outside this Office.",
    );
    expect(shownText(window)).toContain("dry_run=false");
    expect(window.querySelector(".branch-picker")).toBeNull();

    press(buttonNamed(window, "Run Release on main at f00ba12"));
    await until(() =>
      expect(shownText(window)).toContain(
        "main moved to 0badc0d since you looked. Run it again to run that commit.",
      ),
    );
    await until(() => expect(buttonNamed(window, "Run Release on main at 0badc0d")).toBeDefined());

    press(buttonNamed(window, "Run Release on main at 0badc0d"));
    await until(() => expect(document.body.textContent).toContain("Release started on main."));
    const posts = sent.filter(({ request }) => request === `POST ${ACTIONS_PATH}/release/runs`);
    expect(posts.map(({ body }) => body)).toEqual([
      { source: { kind: "branch", branch: "main" }, commit: TIP.commit },
      { source: { kind: "branch", branch: "main" }, commit: MOVED_TIP.commit },
    ]);
  });
});

describe("an Action's History and a run's log", () => {
  it("lists the runs and opens the one the address names, scrolled into view", async () => {
    const scrolled = vi.fn<() => void>();
    Element.prototype.scrollIntoView = scrolled;
    const older = aRun(uuid(2), {
      ranFrom: { kind: "task", taskId: uuid(40), title: "Fix the basket" },
      branch: `office/${uuid(40)}`,
      startedBy: { userId: "u2", name: "Ben" },
    });
    serving(
      [BUILD],
      { [BUILD.key]: [aRun(uuid(1)), older] },
      {
        [`GET /api/action-runs/${uuid(2)}/log?from=0`]: ok({
          text: "[The Office] Checked out f00ba12\nbuilt\n",
          nextOffset: 40,
          status: { kind: "project-command", state: "succeeded" },
          outcome: "succeeded",
        }),
        [`GET /api/action-runs/${uuid(2)}/log?from=40`]: ok({
          text: "",
          nextOffset: 40,
          status: { kind: "project-command", state: "succeeded" },
          outcome: "succeeded",
        }),
      },
    );
    const page = await opened(`/projects/admin-panel/actions/build-it?run=${uuid(2)}`);

    await until(() => expect(page.textContent).toContain("History"));
    const history = page.querySelector<HTMLElement>(".action-history");
    if (!history) throw new Error("No History");
    expect(shownText(history)).toContain("Fix the basket");
    expect(shownText(history)).toContain("Ben");
    expect(shownText(history)).toContain("4 min");
    expect(page.textContent).toContain("The newest 20 runs are kept with their logs.");
    await until(() => expect(scrolled).toHaveBeenCalled());

    const log = dialogNamed("Build it · Succeeded");
    await until(() => expect(shownText(log)).toContain("built"));
    expect(shownText(log)).toContain("Checked out f00ba12");
    expect(buttonNamed(log, "Stop")).toBeUndefined();
  });

  it("says when an Action hasn't run yet", async () => {
    serving([BUILD], {});
    const page = await opened("/projects/admin-panel/actions/build-it");

    await until(() =>
      expect(page.textContent).toContain("Not run yet. Run it to see its runs here."),
    );
  });

  it("streams a running run's log and stops it", async () => {
    const running = aRun(uuid(1), {
      status: { kind: "project-command", state: "running" },
      outcome: null,
      endedAt: null,
    });
    const runningLog = {
      status: running.status,
      outcome: null,
    };
    const sent = serving(
      [BUILD],
      { [BUILD.key]: [running] },
      {
        [`GET /api/action-runs/${uuid(1)}/log?from=0`]: ok({
          ...runningLog,
          text: "[The Office] Running build\n",
          nextOffset: 27,
        }),
        [`GET /api/action-runs/${uuid(1)}/log?from=27`]: ok({
          ...runningLog,
          text: "step 2\n",
          nextOffset: 34,
        }),
        [`GET /api/action-runs/${uuid(1)}/log?from=34`]: ok({
          ...runningLog,
          text: "",
          nextOffset: 34,
        }),
        [`POST /api/action-runs/${uuid(1)}/stop`]: ok({
          ...running,
          status: { kind: "project-command", state: "stopped" },
          outcome: "stopped",
        }),
      },
    );
    await opened(`/projects/admin-panel/actions/build-it?run=${uuid(1)}`);

    const log = await vi.waitFor(() => dialogNamed("Build it · Running"));
    await until(() => expect(shownText(log)).toContain("Running build"));
    // Read on a second later, as it is still running.
    await vi.waitFor(
      async () => {
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 50));
        });
        expect(shownText(log)).toContain("step 2");
      },
      { timeout: 3000 },
    );
    expect(shownText(log)).toContain("Streaming");

    press(buttonNamed(log, "Stop"));
    await until(() => expect(document.body.textContent).toContain("Build it stopped."));
    expect(sent.some(({ request }) => request === `POST /api/action-runs/${uuid(1)}/stop`)).toBe(
      true,
    );
  });

  it("links a Test target run to its test instance", async () => {
    const instanceId = uuid(70);
    serving([INSTALL], {
      [INSTALL.key]: [
        aRun(uuid(1), {
          actionKey: INSTALL.key,
          actionName: INSTALL.name,
          status: { kind: "test-target", state: "built" },
          testInstanceId: instanceId,
        }),
      ],
    });
    const page = await opened("/projects/admin-panel/actions/install-phone");

    await until(() => expect(page.textContent).toContain("Test instance"));
    const link = [...page.querySelectorAll("a")].find(
      (anchor) => shownText(anchor) === "Test instance",
    );
    expect(link?.getAttribute("href")).toBe(
      `/projects/admin-panel/test-targets?testInstance=${instanceId}`,
    );
  });
});
