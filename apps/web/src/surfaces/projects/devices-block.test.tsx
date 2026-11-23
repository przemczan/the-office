import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { Project, ProjectDevice } from "@the-office/contracts";
import { act, useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerDeviceTransport, type RequestedDevice } from "../../api/device-relay.ts";
import { deviceQueries } from "../../api/devices.ts";
import { PAIR_WIRELESS_ERRORS } from "../../shell/devices/device-words.ts";
import {
  buttonNamed,
  closePage,
  openPage,
  shownText,
  stubService,
  typed,
  until,
  type Answers,
} from "../../shell/page.fixtures.tsx";
import { BY_ANN } from "../../shell/user.fixtures.ts";
import { DevicesBlock } from "./devices-block.tsx";
import {
  DIDNT_ANSWER_LINE,
  NEEDS_RUN_ENVIRONMENT,
  NEEDS_RUN_ENVIRONMENT_WHY,
  NO_PROJECT_DEVICES,
  USB_NOTE,
} from "./devices-words.ts";

const PROJECT: Project = {
  id: "shop",
  name: "Shop",
  path: "/projects/shop",
  baseBranch: "main",
  mark: { label: "SH", colour: "teal" },
  installCommand: "npm ci",
  commands: [],
  installInputs: [],
  publishingMode: "merge",
  defaultPipeline: "full",
  icon: { light: null, dark: null },
  logo: { light: null, dark: null },
  repositoryUrl: null,
  beforePublishingCommand: "",
  afterPublishingCommand: "",
  deleteMergedBranches: false,
  environment: { set: [], unset: [], prependPath: [] },
  useProjectSkills: true,
  projectSkillsOff: [],
  engine: { default: null, force: null, people: [] },
  runEnvironment: "on",
  features: {
    "connected-devices": true,
    "test-targets": true,
    "github-issues": true,
    "run-environment": true,
    actions: true,
  },
  projectLimit: 1,
  addedAt: "2026-11-01T10:00:00.000Z",
  codeHost: null,
  kindDefaultPipelines: { feature: null, bug: null, chore: null },
  defaultPipelineOfKind: { feature: "full", bug: "full", chore: "full" },
  issueSettings: {
    autoImportLabel: null,
    closeOnDone: true,
    commentOnStartAndDone: false,
    closeOnDrop: false,
  },
};

const PHONE: ProjectDevice = {
  id: "00000000-0000-4000-8000-0000000000a1",
  projectId: PROJECT.id,
  kind: "android-wireless",
  deviceKey: "wireless:192.168.1.20",
  name: "Pixel 8",
  address: "192.168.1.20",
  port: 37_099,
  state: "paired",
  inUseBy: null,
  pairingStep: null,
  pairingProblem: null,
  addedBy: BY_ANN,
  addedAt: "2026-11-20T09:00:00.000Z",
  lastUse: {
    holder: { kind: "task", taskId: "00000000-0000-4000-8000-0000000000b1", title: "Fix sign-in" },
    endedAt: "2026-11-21T10:00:00.000Z",
    endedBecause: "by-user",
  },
};

const BOARD: ProjectDevice = {
  ...PHONE,
  id: "00000000-0000-4000-8000-0000000000a2",
  kind: "serial-usb",
  deviceKey: "serial:2341:0043:abc",
  name: "Arduino Uno",
  address: null,
  port: null,
  state: "over-usb",
  lastUse: null,
};

const HELD: ProjectDevice = {
  ...PHONE,
  id: "00000000-0000-4000-8000-0000000000a3",
  name: "Galaxy S24",
  address: "192.168.1.21",
  state: "in-use",
  inUseBy: { kind: "task", taskId: "00000000-0000-4000-8000-0000000000b2", title: "Flash it" },
};

const QUIET: ProjectDevice = {
  ...PHONE,
  id: "00000000-0000-4000-8000-0000000000a4",
  name: "Pixel 6",
  address: "192.168.1.22",
  state: "didnt-answer",
};

const DEVICES_PATH = `GET /api/projects/${PROJECT.id}/devices`;
const ADD_PATH = `POST /api/projects/${PROJECT.id}/devices`;

let queryClient: QueryClient | undefined;

/** Hands the test the page's query client, so it can read the devices again as an event does. */
function Grab(): null {
  const client = useQueryClient();
  useEffect(() => {
    queryClient = client;
  }, [client]);
  return null;
}

async function blockOf(project: Project = PROJECT): Promise<HTMLElement> {
  const { page } = await openPage("/", {
    "/": () => (
      <>
        <Grab />
        <DevicesBlock project={project} />
      </>
    ),
  });
  return page;
}

/** The devices the service lists, changed by the test as a pairing goes on. */
function listing(devices: readonly ProjectDevice[]): {
  devices: readonly ProjectDevice[];
  answers: Answers;
} {
  const listed = { devices, answers: {} as Answers };
  listed.answers = { [DEVICES_PATH]: () => ({ status: 200, body: { devices: listed.devices } }) };
  return listed;
}

/** As `project-device.changed` does: the Project's devices are read again. */
async function deviceChanged(): Promise<void> {
  await act(async () => {
    await queryClient?.invalidateQueries({
      queryKey: deviceQueries.ofProject(PROJECT.id).queryKey,
    });
  });
}

function rowOf(page: HTMLElement, name: string): HTMLElement {
  const row = page.querySelector<HTMLElement>(`li[aria-label="${name}"]`);
  if (row === null) throw new Error(`There is no row for ${name}.`);
  return row;
}

function badgeColour(row: HTMLElement, words: string): string | undefined {
  return [...row.querySelectorAll<HTMLElement>("span")].find((span) => shownText(span) === words)
    ?.style.color;
}

function fieldLabelled(label: string): HTMLInputElement | undefined {
  const labelElement = [...document.body.querySelectorAll("label")].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  const input = labelElement && document.getElementById(labelElement.htmlFor);
  return input instanceof HTMLInputElement ? input : undefined;
}

function dialogTitled(title: string): HTMLElement | undefined {
  return [...document.body.querySelectorAll<HTMLElement>('[role="dialog"]')].find((dialog) => {
    const titleId = dialog.getAttribute("aria-labelledby");
    const named = titleId === null ? null : document.getElementById(titleId);
    return named !== null && shownText(named) === title;
  });
}

function setValue(input: HTMLInputElement, text: string): void {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    set?.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const GOOD = {
  "IP address": "192.168.1.30",
  Port: "37099",
  "Pairing port": "41235",
  "Pairing code": "482913",
};

async function openAddWireless(page: HTMLElement): Promise<void> {
  await until(() => expect(buttonNamed(page, "Add a device")).toBeDefined());
  act(() => buttonNamed(page, "Add a device")?.click());
  act(() =>
    buttonNamed(page.querySelector('[role="menu"]')!, "Phone over wireless debugging")?.click(),
  );
  await until(() => expect(dialogTitled("Add a phone over wireless debugging")).toBeDefined());
}

function fillAndPair(): void {
  for (const [label, text] of Object.entries(GOOD)) typed(document.body, label, text);
  act(() => buttonNamed(document.body, "Pair")?.click());
}

describe("a Project's Devices section", () => {
  afterEach(() => {
    closePage();
    queryClient = undefined;
  });

  it("lists each device with its kind, its state in its tone, its place and its last use", async () => {
    stubService(listing([PHONE, BOARD, HELD, QUIET]).answers);
    const page = await blockOf();
    await until(() => expect(page.querySelector('li[aria-label="Pixel 8"]')).not.toBeNull());

    expect(shownText(page)).toContain(
      "Phones and boards kept for Shop, so an Action or a test target reaches them with nobody connecting them first.",
    );
    const phone = rowOf(page, "Pixel 8");
    expect(shownText(phone)).toContain("Android phone over wireless debugging");
    expect(phone.querySelector("code")?.textContent).toBe("192.168.1.20:37099");
    expect(shownText(phone)).toContain("Last used by Fix sign-in");
    expect(shownText(phone)).toContain("given back");
    expect(badgeColour(phone, "Paired")).toContain("--success-fg");

    const board = rowOf(page, "Arduino Uno");
    expect(shownText(board)).toContain("Serial board over USB");
    expect(shownText(board)).toContain("Not used yet");
    expect(badgeColour(board, "Over USB")).toContain("--neutral-fg");
    expect(buttonNamed(board, "Change Port")).toBeUndefined();

    const held = rowOf(page, "Galaxy S24");
    expect(badgeColour(held, "In use")).toContain("--info-fg");
    expect(held.querySelector('a[href^="/tasks/"]')?.textContent).toBe("Flash it");
    const trash = buttonNamed(held, "Remove Galaxy S24");
    expect(trash?.disabled).toBe(true);
    expect(trash?.title).toBe("In use by Flash it: remove it once it is let go of.");

    const quiet = rowOf(page, "Pixel 6");
    expect(badgeColour(quiet, "Didn't answer")).toContain("--warning-fg");
    expect(shownText(quiet)).toContain(DIDNT_ANSWER_LINE);
    expect(shownText(page)).toContain(USB_NOTE);
  });

  it("says when there are none", async () => {
    stubService(listing([]).answers);
    const page = await blockOf();
    await until(() => expect(shownText(page)).toContain(NO_PROJECT_DEVICES));
  });

  it("keeps the devices listed while Run environment isn't On, holding Add a device and Pair again", async () => {
    stubService(listing([PHONE]).answers);
    const page = await blockOf({ ...PROJECT, runEnvironment: "off" });
    await until(() => expect(page.querySelector('li[aria-label="Pixel 8"]')).not.toBeNull());

    expect(shownText(page)).toContain(NEEDS_RUN_ENVIRONMENT);
    expect(
      [...page.querySelectorAll("a")]
        .find((link) => link.textContent === "Run environment")
        ?.getAttribute("href"),
    ).toBe("/projects/shop/run-environment");
    const add = buttonNamed(page, "Add a device");
    expect(add?.disabled).toBe(true);
    expect(add?.title).toBe(NEEDS_RUN_ENVIRONMENT_WHY);
    const again = buttonNamed(rowOf(page, "Pixel 8"), "Pair again");
    expect(again?.disabled).toBe(true);
    expect(again?.title).toBe(NEEDS_RUN_ENVIRONMENT_WHY);
  });

  it("renames a device in place", async () => {
    const sent = stubService({
      ...listing([PHONE]).answers,
      [`PATCH /api/project-devices/${PHONE.id}`]: () => ({
        status: 200,
        body: { ...PHONE, name: "Lab phone" },
      }),
    });
    const page = await blockOf();
    await until(() => expect(buttonNamed(page, "Rename Pixel 8")).toBeDefined());

    act(() => buttonNamed(page, "Rename Pixel 8")?.click());
    const field = page.querySelector<HTMLInputElement>('input[aria-label="Name of Pixel 8"]')!;
    expect(field.maxLength).toBe(60);
    setValue(field, "Lab phone");
    act(() => buttonNamed(page, "Save")?.click());

    await until(() => expect(shownText(document.body)).toContain("Lab phone renamed."));
    expect(sent.find(({ request }) => request.startsWith("PATCH"))?.body).toEqual({
      name: "Lab phone",
    });
  });

  it("changes a phone's Port in its window", async () => {
    const sent = stubService({
      ...listing([PHONE]).answers,
      [`PATCH /api/project-devices/${PHONE.id}`]: () => ({
        status: 200,
        body: { ...PHONE, port: 40_111 },
      }),
    });
    const page = await blockOf();
    await until(() => expect(buttonNamed(page, "Change Port")).toBeDefined());

    act(() => buttonNamed(page, "Change Port")?.click());
    await until(() => expect(dialogTitled("Change Pixel 8's Port")).toBeDefined());
    expect(fieldLabelled("Port")?.value).toBe("37099");
    expect(shownText(document.body)).toContain(
      "No pairing needed: the phone trusts Shop's key until office@shop is removed from its paired devices.",
    );
    typed(document.body, "Port", "70000");
    act(() => buttonNamed(document.body, "Save")?.click());
    expect(shownText(document.body)).toContain(PAIR_WIRELESS_ERRORS.badPort);

    typed(document.body, "Port", "40111");
    act(() => buttonNamed(document.body, "Save")?.click());
    await until(() => expect(shownText(document.body)).toContain("Pixel 8's Port saved."));
    expect(sent.find(({ request }) => request.startsWith("PATCH"))?.body).toEqual({
      port: 40_111,
    });
    expect(dialogTitled("Change Pixel 8's Port")).toBeUndefined();
  });

  it("removes a device at rest, and shows a refusal under the card", async () => {
    const sent = stubService({
      ...listing([PHONE, BOARD]).answers,
      [`DELETE /api/project-devices/${PHONE.id}`]: () => ({ status: 204 }),
      [`DELETE /api/project-devices/${BOARD.id}`]: () => ({
        status: 409,
        body: {
          statusCode: 409,
          message: "Arduino Uno is in use by Flash it.",
          reasons: ["Arduino Uno is in use by Flash it."],
          holder: { kind: "task", taskId: "x", title: "Flash it" },
        },
      }),
    });
    const page = await blockOf();
    await until(() => expect(buttonNamed(page, "Remove Pixel 8")).toBeDefined());

    act(() => buttonNamed(page, "Remove Pixel 8")?.click());
    await until(() =>
      expect(shownText(document.body)).toContain(
        "Pixel 8 removed from Shop's devices. The phone keeps trusting Shop's key until you remove it there.",
      ),
    );
    expect(sent.map(({ request }) => request)).toContain(`DELETE /api/project-devices/${PHONE.id}`);

    act(() => buttonNamed(page, "Remove Arduino Uno")?.click());
    await until(() => expect(shownText(page)).toContain("The device wasn't saved"));
    expect(shownText(page)).toContain("Arduino Uno is in use by Flash it.");
  });

  it("adds a device over USB through the browser's picker, letting go of it at once", async () => {
    const release = vi.fn<() => void>();
    const phone: RequestedDevice = {
      name: "Google Pixel 7",
      deviceKey: "usb:18d1:4ee7:serial",
      attach: () => ({ opened: () => {}, received: () => {}, closed: () => {}, end: () => {} }),
      onUnplugged: () => () => {},
      release,
    };
    const unregister = registerDeviceTransport({
      kind: "android-usb",
      request: () => Promise.resolve(phone),
    });
    try {
      const sent = stubService({
        ...listing([]).answers,
        [ADD_PATH]: () => ({
          status: 201,
          body: { ...BOARD, kind: "android-usb", name: "Google Pixel 7" },
        }),
      });
      const page = await blockOf();
      await until(() => expect(buttonNamed(page, "Add a device")).toBeDefined());

      act(() => buttonNamed(page, "Add a device")?.click());
      act(() =>
        buttonNamed(page.querySelector('[role="menu"]')!, "Android phone over USB")?.click(),
      );

      await until(() =>
        expect(shownText(document.body)).toContain("Google Pixel 7 added to Shop's devices."),
      );
      expect(sent.find(({ request }) => request === ADD_PATH)?.body).toEqual({
        kind: "android-usb",
        name: "Google Pixel 7",
        deviceKey: "usb:18d1:4ee7:serial",
      });
      expect(release).toHaveBeenCalled();
    } finally {
      unregister();
    }
  });

  it("checks the pairing window's fields before sending", async () => {
    const sent = stubService(listing([]).answers);
    const page = await blockOf();
    await openAddWireless(page);

    expect(shownText(document.body)).toContain(
      "Pairing starts a pairing environment from main's .devcontainer/ and removes it once done.",
    );
    act(() => buttonNamed(document.body, "Pair")?.click());
    const shown = shownText(document.body);
    expect(shown).toContain(PAIR_WIRELESS_ERRORS.noAddress);
    expect(shown).toContain(PAIR_WIRELESS_ERRORS.noPort);
    expect(shown).toContain(PAIR_WIRELESS_ERRORS.noPairingCode);
    expect(sent.map(({ request }) => request)).not.toContain(ADD_PATH);
  });

  it("pairs a phone, showing its steps as they pass, and closes once Paired", async () => {
    const pairing: ProjectDevice = {
      ...PHONE,
      name: "192.168.1.30",
      address: "192.168.1.30",
      state: "not-paired",
      pairingStep: "starting-environment",
      lastUse: null,
    };
    const listed = listing([]);
    const sent = stubService({
      ...listed.answers,
      [ADD_PATH]: () => ({ status: 201, body: pairing }),
    });
    const page = await blockOf();
    await openAddWireless(page);

    fillAndPair();
    expect(fieldLabelled("Pairing code")?.value).toBe("");
    await until(() =>
      expect(shownText(document.body)).toContain("Starting the pairing environment…"),
    );
    expect(sent.find(({ request }) => request === ADD_PATH)?.body).toEqual({
      kind: "android-wireless",
      address: "192.168.1.30",
      port: 37_099,
      pairingPort: 41_235,
      pairingCode: "482913",
    });

    listed.devices = [{ ...pairing, pairingStep: "reading-model" }];
    await deviceChanged();
    await until(() => expect(shownText(document.body)).toContain("Reading its model…"));

    listed.devices = [{ ...pairing, name: "Pixel 7", state: "paired", pairingStep: null }];
    await deviceChanged();
    await until(() => expect(shownText(document.body)).toContain("Pixel 7 paired with Shop."));
    expect(dialogTitled("Add a phone over wireless debugging")).toBeUndefined();
  });

  it("keeps a failed pairing in the window, and Pair tries again with a new code", async () => {
    const failed: ProjectDevice = {
      ...PHONE,
      name: "192.168.1.30",
      address: "192.168.1.30",
      state: "not-paired",
      pairingStep: "starting-environment",
      lastUse: null,
    };
    const listed = listing([]);
    const sent = stubService({
      ...listed.answers,
      [ADD_PATH]: () => ({ status: 201, body: failed }),
      [`POST /api/project-devices/${failed.id}/pair`]: () => ({ status: 201, body: failed }),
    });
    const page = await blockOf();
    await openAddWireless(page);
    fillAndPair();
    await until(() =>
      expect(shownText(document.body)).toContain("Starting the pairing environment…"),
    );

    listed.devices = [
      { ...failed, pairingStep: null, pairingProblem: "adb pair: the pairing code is wrong." },
    ];
    await deviceChanged();
    await until(() =>
      expect(shownText(document.body)).toContain("adb pair: the pairing code is wrong."),
    );
    expect(shownText(document.body)).toContain("The phone wasn't paired");

    typed(document.body, "Pairing code", "112233");
    act(() => buttonNamed(document.body, "Pair")?.click());
    await until(() =>
      expect(sent.map(({ request }) => request)).toContain(
        `POST /api/project-devices/${failed.id}/pair`,
      ),
    );
  });

  it("shows a refusal before pairing in the window", async () => {
    stubService({
      ...listing([]).answers,
      [ADD_PATH]: () => ({
        status: 422,
        body: {
          statusCode: 422,
          message: "The phone at 192.168.1.30 is already among Shop's devices.",
          reasons: ["The phone at 192.168.1.30 is already among Shop's devices."],
          holder: null,
        },
      }),
    });
    const page = await blockOf();
    await openAddWireless(page);
    fillAndPair();

    await until(() => expect(shownText(document.body)).toContain("The phone wasn't paired"));
    expect(shownText(document.body)).toContain(
      "The phone at 192.168.1.30 is already among Shop's devices.",
    );
    expect(fieldLabelled("Pairing code")?.value).toBe("");
  });

  it("pairs a phone again in the same window, its address and Port filled in", async () => {
    stubService(listing([PHONE]).answers);
    const page = await blockOf();
    await until(() => expect(buttonNamed(page, "Pair again")).toBeDefined());

    act(() => buttonNamed(page, "Pair again")?.click());
    await until(() => expect(dialogTitled("Pair Pixel 8 again")).toBeDefined());
    expect(fieldLabelled("IP address")?.value).toBe("192.168.1.20");
    expect(fieldLabelled("Port")?.value).toBe("37099");
    expect(fieldLabelled("Pairing code")?.value).toBe("");
  });
});
