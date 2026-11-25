import type { Action, ActionsEdit } from "@the-office/contracts";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  closePage,
  openPage,
  shownText,
  stubService,
  typed,
  until,
  type Answers,
} from "../../../shell/page.fixtures.tsx";
import {
  ANDROID,
  BUILD,
  GONE_TARGET,
  INSTALL,
  ON_PIXEL,
  PIXEL,
  PROJECT,
  RELEASE,
  WORKFLOWS,
} from "./actions.fixtures.ts";
import { ProjectActionsSection } from "./project-actions-section.tsx";

vi.mock("../../../shell/ask-devops.tsx", () => ({
  useDevops: () => undefined,
  AskDevopsButton: ({ label }: { label: (name: string) => string }) => (
    <button type="button">{label("Nina")}</button>
  ),
}));
vi.mock("../../../shell/use-user-name.ts", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useSignedInUserId: () => "u1",
}));
const openProject = vi.hoisted(() => ({ runEnvironment: "on" as "on" | "off" }));
vi.mock("../project-page.tsx", async () => {
  const fixtures = await import("./actions.fixtures.ts");
  return {
    useOpenProject: () => ({ ...fixtures.PROJECT, runEnvironment: openProject.runEnvironment }),
  };
});

const ACTIONS_PATH = "/api/projects/admin-panel/actions";

/** The Actions, the test targets, the devices and the workflows; a save answers what it was sent. */
function serving(
  actions: readonly Action[],
  put?: Answers[string],
  devices = [PIXEL],
): ReturnType<typeof stubService> {
  return stubService({
    [`GET ${ACTIONS_PATH}`]: () => ({ status: 200, body: { actions } }),
    [`PUT ${ACTIONS_PATH}`]:
      put ??
      ((body) => ({
        status: 200,
        body: {
          actions: (body as ActionsEdit).actions.map((action) => ({ ...action, setBy: {} })),
        },
      })),
    "GET /api/projects/admin-panel/test-targets": () => ({
      status: 200,
      body: { targets: [ANDROID] },
    }),
    "GET /api/projects/admin-panel/devices": () => ({ status: 200, body: { devices } }),
    "GET /api/projects/admin-panel/workflows?ref=main": () => ({ status: 200, body: WORKFLOWS }),
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

/** The button named `name` by its label or its text, read without cloning it. */
function buttonNamed(scope: ParentNode, name: string): HTMLButtonElement | undefined {
  return [...scope.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => (button.getAttribute("aria-label") ?? textOf(button).trim()) === name,
  );
}

/** An element's text, leaving out the styles the design system's controls carry. */
function textOf(node: Node): string {
  if (node.nodeName === "STYLE") return "";
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  return [...node.childNodes].map(textOf).join("");
}

function press(button: HTMLButtonElement | undefined): void {
  if (!button) throw new Error("No such button");
  act(() => button.click());
}

function radio(label: string): HTMLInputElement {
  const found = [...document.querySelectorAll<HTMLLabelElement>(".radio-list-item")].find((each) =>
    each.textContent.startsWith(label),
  );
  const input = found?.querySelector("input");
  if (!input) throw new Error(`No radio ${label}`);
  return input;
}

function checkbox(label: string): HTMLElement {
  const found = [...document.querySelectorAll<HTMLElement>("[role=checkbox], label")].find((each) =>
    shownText(each).startsWith(label),
  );
  if (!found) throw new Error(`No checkbox ${label}`);
  return found;
}

function isChecked(label: string): boolean {
  const box = checkbox(label);
  const input = box.querySelector("input");
  if (input) return input.checked;
  return (
    box.getAttribute("aria-checked") === "true" ||
    box.querySelector("[aria-checked]")?.getAttribute("aria-checked") === "true"
  );
}

function selectNamed(label: string): HTMLSelectElement {
  const found = [...document.querySelectorAll("label")].find(
    (each) => shownText(each).replace("*", "").trim() === label,
  );
  const select = found && document.getElementById(found.htmlFor);
  if (!(select instanceof HTMLSelectElement)) throw new Error(`No select ${label}`);
  return select;
}

function choose(select: HTMLSelectElement, value: string): void {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

/** The Actions a save sent, none when it wasn't sent. */
function sentActions(put: { readonly body: unknown } | undefined): ActionsEdit["actions"] {
  return put === undefined ? [] : (put.body as ActionsEdit).actions;
}

afterEach(() => {
  closePage();
  openProject.runEnvironment = "on";
});

describe("the Project page's Actions list", () => {
  it("shows a row per Action with its key, what it runs, its mark and who set it", async () => {
    serving([BUILD, INSTALL, RELEASE]);
    const page = await opened();

    expect(shownText(page)).toContain("Admin panel's Actions3");
    const build = rowOf(page, "Build it");
    expect(shownText(build)).toContain("build-it");
    expect(shownText(build)).toContain("Project command · build");
    expect(shownText(build)).toContain("Set by you");
    await until(() =>
      expect(shownText(rowOf(page, "Install on my phone"))).toContain("Test target · Android app"),
    );
    expect(shownText(rowOf(page, "Install on my phone"))).toContain("Set by you and Nina");
    const release = rowOf(page, "Release");
    expect(shownText(release)).toContain("Workflow · release.yml");
    expect(shownText(release)).toContain("Leaves the workstation");
    expect(shownText(build)).not.toContain("Leaves the workstation");
    expect(buttonNamed(build, "Change Build it")).toBeDefined();
    expect(buttonNamed(build, "Remove Build it")).toBeDefined();
    expect(page.textContent).toContain(
      "Things to run on demand, outside the Task queue. Kept in The Office, never in the repository.",
    );
    expect(buttonNamed(page, "Ask Nina to propose Actions")).toBeDefined();
    expect(page.textContent).toContain("Open an Action to see its runs.");
  });

  it("warns of a command, test target or Workflow the Project no longer has", async () => {
    serving([BUILD, GONE_TARGET, RELEASE]);
    const page = await opened();

    expect(shownText(rowOf(page, "Build it"))).toContain(
      "gone isn't one of the Project's commands anymore.",
    );
    expect(shownText(rowOf(page, "Build it"))).not.toContain("install isn't");
    await until(() =>
      expect(shownText(rowOf(page, "Install on my tablet"))).toContain(
        "tablet isn't one of Admin panel's test targets anymore.",
      ),
    );
    await until(() =>
      expect(shownText(rowOf(page, "Release"))).toContain(
        "release.yml doesn't declare a start by hand on main anymore.",
      ),
    );
  });

  it("warns of a device the Project no longer has", async () => {
    serving([ON_PIXEL], undefined, []);
    const page = await opened();

    await until(() =>
      expect(shownText(rowOf(page, "Smoke test on Pixel"))).toContain(
        "Its device isn't one of Admin panel's devices anymore.",
      ),
    );
  });

  it("disables Run of an Action holding a device while Run environment isn't On", async () => {
    openProject.runEnvironment = "off";
    serving([ON_PIXEL, BUILD]);
    const page = await opened();

    const row = rowOf(page, "Smoke test on Pixel");
    expect(shownText(row)).toContain("Needs Run environment On to run.");
    expect(row.querySelector("a[href$='/run-environment']")).not.toBeNull();
    expect(buttonNamed(row, "Run Smoke test on Pixel")?.disabled).toBe(true);
    expect(shownText(rowOf(page, "Build it"))).not.toContain("Needs Run environment On");
    expect(buttonNamed(rowOf(page, "Build it"), "Run Build it")?.disabled).toBe(false);
  });

  it("says what fills it while it has none", async () => {
    serving([]);
    const page = await opened();

    expect(page.textContent).toContain(
      "No Actions yet. Add one, such as an install on a phone or a release, or have Devops propose them from the repository.",
    );
  });

  it("removes an Action at once, saving the rest, with a toast", async () => {
    const sent = serving([BUILD, RELEASE]);
    const page = await opened();

    press(buttonNamed(rowOf(page, "Build it"), "Remove Build it"));
    await until(() => expect(document.body.textContent).toContain("Build it removed."));

    const put = sent.find(({ request }) => request === `PUT ${ACTIONS_PATH}`);
    expect(sentActions(put).map(({ key }) => key)).toEqual(["release"]);
    expect(page.querySelector("nav")?.textContent).not.toContain("Build it");
  });

  it("opens an Action's head card at its address, and says so of a key it lacks", async () => {
    serving([RELEASE]);
    const page = await opened("/projects/admin-panel/actions/release");
    const card = page.querySelector(".project-actions-detail");
    expect(shownText(card ?? page)).toContain("Workflow · release.yml");
    expect(buttonNamed(card ?? page, "Change Release")).toBeDefined();
    closePage();

    serving([RELEASE]);
    const other = await opened("/projects/admin-panel/actions/gone");
    expect(other.textContent).toContain(
      "Admin panel has no such Action: it may have been removed.",
    );
  });
});

describe("the Action editor", () => {
  it("adds a Project command Action with its commands before it and its own time limit", async () => {
    const sent = serving([]);
    const page = await opened();

    press(buttonNamed(page, "Add an Action"));
    expect(document.body.textContent).toContain(
      "Runs one of Admin panel's commands in a fresh checkout of what you pick.",
    );
    typed(document.body, "Key", "build-it");
    typed(document.body, "Name", "Build it");
    choose(selectNamed("Command"), "build");
    choose(selectNamed("Add a command"), "install");
    press(buttonNamed(document.body, "Set its own limit"));
    press(buttonNamed(document.body, "Raise the time limit"));
    expect(document.body.textContent).toContain("65 minutes");
    expect(document.body.textContent).toContain(
      "OFFICE_ACTION, OFFICE_ACTION_BRANCH and OFFICE_ACTION_COMMIT",
    );
    expect(isChecked("Leaves the workstation")).toBe(false);

    press(buttonNamed(document.body, "Add the Action"));
    await until(() => expect(document.body.textContent).toContain("Build it added."));
    const put = sent.find(({ request }) => request === `PUT ${ACTIONS_PATH}`);
    expect(sentActions(put)).toEqual([
      {
        key: "build-it",
        name: "Build it",
        kind: "project-command",
        leavesTheWorkstation: false,
        settings: {
          commandKey: "build",
          commandsBefore: ["install"],
          timeLimitMinutes: 65,
          projectDeviceId: null,
        },
      },
    ]);
  });

  it("names a Project device a Project command's run holds", async () => {
    const sent = serving([]);
    const page = await opened();

    press(buttonNamed(page, "Add an Action"));
    typed(document.body, "Key", "smoke");
    typed(document.body, "Name", "Smoke");
    choose(selectNamed("Command"), "build");
    await until(() => expect(selectNamed("Device")).toBeDefined());
    expect(document.body.textContent).toContain(
      "Held by the run while it runs. Needs Run environment On.",
    );
    expect([...selectNamed("Device").options].map(({ text }) => text)).toEqual([
      "None",
      "Pixel 8 · Android phone over wireless debugging",
    ]);
    choose(selectNamed("Device"), PIXEL.id);

    press(buttonNamed(document.body, "Add the Action"));
    await until(() => expect(document.body.textContent).toContain("Smoke added."));
    const put = sent.find(({ request }) => request === `PUT ${ACTIONS_PATH}`);
    expect(sentActions(put)[0]?.settings).toMatchObject({ projectDeviceId: PIXEL.id });
  });

  it("says the Project has no devices yet, linking to Devices", async () => {
    serving([], undefined, []);
    const page = await opened();

    press(buttonNamed(page, "Add an Action"));
    await until(() =>
      expect(document.body.textContent).toContain(`${PROJECT.name} has no devices yet.`),
    );
    expect(document.body.querySelector("a[href$='/devices']")?.textContent).toBe(
      "Add one under Devices",
    );
  });

  it("ticks Leaves the workstation as Workflow is chosen, and fixes the workflow's inputs", async () => {
    const sent = serving([]);
    const page = await opened();

    press(buttonNamed(page, "Add an Action"));
    typed(document.body, "Key", "deploy");
    typed(document.body, "Name", "Deploy");
    act(() => radio("Workflow").click());
    expect(isChecked("Leaves the workstation")).toBe(true);
    await until(() => expect(selectNamed("Workflow file")).toBeDefined());
    choose(selectNamed("Workflow file"), "deploy.yml");
    expect(document.body.textContent).toContain(
      "Fixed with the Action: nothing is asked at its start.",
    );
    choose(selectNamed("channel"), "stable");

    press(buttonNamed(document.body, "Add the Action"));
    await until(() => expect(document.body.textContent).toContain("Deploy added."));
    const put = sent.find(({ request }) => request === `PUT ${ACTIONS_PATH}`);
    expect(sentActions(put)[0]).toEqual({
      key: "deploy",
      name: "Deploy",
      kind: "workflow",
      leavesTheWorkstation: true,
      settings: { file: "deploy.yml", inputs: { channel: "stable" } },
    });
  });

  it("steps the time limit a minute at a time up to 10, so it reaches 1", async () => {
    serving([]);
    const page = await opened();

    press(buttonNamed(page, "Add an Action"));
    press(buttonNamed(document.body, "Set its own limit"));
    for (let presses = 0; presses < 19; presses += 1) {
      press(buttonNamed(document.body, "Lower the time limit"));
    }

    expect(document.body.textContent).toContain("1 minute");
    expect(buttonNamed(document.body, "Lower the time limit")?.disabled).toBe(true);
  });

  it("sends a new Workflow Action unmarked when the user clears the tick", async () => {
    const sent = serving([]);
    const page = await opened();

    press(buttonNamed(page, "Add an Action"));
    typed(document.body, "Key", "deploy");
    typed(document.body, "Name", "Deploy");
    act(() => radio("Workflow").click());
    await until(() => expect(selectNamed("Workflow file")).toBeDefined());
    choose(selectNamed("Workflow file"), "deploy.yml");
    act(() => checkbox("Leaves the workstation").click());

    press(buttonNamed(document.body, "Add the Action"));
    await until(() => expect(document.body.textContent).toContain("Deploy added."));
    const put = sent.find(({ request }) => request === `PUT ${ACTIONS_PATH}`);
    expect(sentActions(put)[0]).toMatchObject({ key: "deploy", leavesTheWorkstation: false });
  });

  it("warns of an input the Action fixed that its file no longer declares", async () => {
    serving([
      {
        ...RELEASE,
        key: "deploy",
        name: "Deploy",
        settings: { file: "deploy.yml", inputs: { channel: "stable", dry_run: "true" } },
      },
    ]);
    const page = await opened();

    press(buttonNamed(rowOf(page, "Deploy"), "Change Deploy"));

    await until(() =>
      expect(document.body.textContent).toContain(
        "dry_run isn't an input deploy.yml declares on main anymore; saving leaves it out.",
      ),
    );
  });

  it("keeps the key fixed once added, shows who set a value, and saves a change", async () => {
    const sent = serving([INSTALL]);
    const page = await opened();

    press(buttonNamed(rowOf(page, "Install on my phone"), "Change Install on my phone"));
    const window = document.querySelector<HTMLElement>(
      "form[aria-label='Change Install on my phone']",
    );
    if (!window) throw new Error("No editor");
    expect([...window.querySelectorAll("label")].some((each) => shownText(each) === "Key")).toBe(
      false,
    );
    expect(shownText(window)).toContain("Key install-phone");
    expect(shownText(window)).toContain("Set by Nina");
    await until(() => expect(selectNamed("Test target").value).toBe("android"));
    typed(document.body, "Name", "Install on a phone");

    press(buttonNamed(document.body, "Save"));
    await until(() =>
      expect(document.body.textContent).toContain(
        "Install on a phone saved. It applies from its next run.",
      ),
    );
    const put = sent.find(({ request }) => request === `PUT ${ACTIONS_PATH}`);
    expect(sentActions(put)[0]).toMatchObject({
      key: "install-phone",
      name: "Install on a phone",
    });
  });

  it("shows a refusal in the window as the service words it", async () => {
    serving([], () => ({
      status: 400,
      body: { message: "A Project variable is named OFFICE_ACTION, which The Office sets." },
    }));
    const page = await opened();

    press(buttonNamed(page, "Add an Action"));
    typed(document.body, "Key", "build-it");
    typed(document.body, "Name", "Build it");
    choose(selectNamed("Command"), "build");
    press(buttonNamed(document.body, "Add the Action"));

    await until(() => expect(document.body.textContent).toContain("The Action wasn't saved"));
    expect(document.body.textContent).toContain(
      "A Project variable is named OFFICE_ACTION, which The Office sets.",
    );
    expect(document.querySelector("form[aria-label='Add an Action']")).not.toBeNull();
  });
});
