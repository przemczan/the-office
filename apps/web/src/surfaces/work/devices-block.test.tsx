import type { ConnectedDevice, Project, Task } from "@the-office/contracts";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerDeviceTransport, type RequestedDevice } from "../../api/device-relay.ts";
import {
  buttonNamed,
  closePage,
  openPage,
  shownText,
  stubService,
  until,
  type Answers,
} from "../../shell/page.fixtures.tsx";
import { BY_ANN } from "../../shell/user.fixtures.ts";
import { closeEveryDeviceRelay } from "./device-relays.ts";
import { KEEP_TAB_OPEN } from "./device-words.ts";
import { DevicesBlock } from "./devices-block.tsx";
import {
  ALLOW_USB_DEBUGGING,
  NEEDS_SECURE_CONTEXT,
  NEEDS_WEBUSB,
  PHONE_IN_USE,
  USB_DEBUGGING_HINT,
} from "./devices/android-usb/android-usb-words.ts";

const TASK: Task = {
  id: "00000000-0000-4000-8000-000000000031",
  title: "Sign-in keeps the page",
  description: "Keep the query string.",
  projectId: "firmware",
  priority: "normal",
  tags: [],
  state: "in-progress",
  plan: "Keep the path.",
  pausedBy: null,
  engineStandIns: [],
  resumesAt: null,
  autoMode: false,
  initiativePlanningThreadId: null,
  markedPlanned: false,
  hasPlanningThread: false,
  planConfirmed: true,
  filesToChange: [],
  estimatedTokens: null,
  definitionOfDone: ["Sign-in returns."],
  definitionOfDoneConfirmed: true,
  commitMessage: "Sign-in keeps the page\n\nKeep the query string.",
  commitMessageWritten: false,
  commitMessagePublishedAt: null,
  pipelineId: "full",
  proposedPipeline: null,
  blockedBy: [],
  originIdeaId: null,
  initiativeId: null,
  madeFor: null,
  resolvesTaskId: null,
  projectMoves: [],
  createdBy: { kind: "user", user: null },
  createdAt: "2026-10-28T10:00:00.000Z",
  archivedAt: null,
  endedAt: null,
  pullRequestEnd: null,
  kind: "feature",
  causedBy: null,
  foundInVersion: null,
  foundWhileWorkingOn: null,
  dropReason: null,
};

const PROJECT: Project = {
  id: "firmware",
  name: "Admin panel",
  path: "/projects/admin-panel",
  baseBranch: "main",
  mark: { label: "AP", colour: "teal" },
  installCommand: "npm ci",
  commands: [],
  installInputs: ["package-lock.json"],
  publishingMode: "merge",
  defaultPipeline: "full",
  icon: { light: null, dark: null },
  logo: { light: null, dark: null },
  repositoryUrl: null,
  beforePublishingCommand: "",
  afterPublishingCommand: "",
  environment: { set: [], unset: [], prependPath: [] },
  useProjectSkills: true,
  projectSkillsOff: [],
  projectDefault: null,
  useForEveryRole: false,
  roleOverrides: [],
  runEnvironment: "on",
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

const PHONE: ConnectedDevice = {
  id: "00000000-0000-4000-8000-0000000000d1",
  taskId: TASK.id,
  kind: "android-usb",
  name: "Pixel 8",
  state: "connected",
  disconnectedBecause: null,
  disconnectedBy: null,
  problem: null,
  endpoint: "127.0.0.1:5555",
  connectedBy: BY_ANN,
  connectedAt: "2026-11-20T09:30:00.000Z",
  disconnectedAt: null,
};

const BOARD: ConnectedDevice = {
  ...PHONE,
  id: "00000000-0000-4000-8000-0000000000d2",
  kind: "serial-usb",
  name: "Arduino Uno",
  state: "waiting-for-run-environment",
  endpoint: null,
};

const UNPLUGGED: ConnectedDevice = {
  ...PHONE,
  id: "00000000-0000-4000-8000-0000000000d3",
  name: "Old phone",
  state: "disconnected",
  disconnectedBecause: "by-user",
  disconnectedBy: BY_ANN,
  endpoint: null,
  disconnectedAt: "2026-11-20T10:00:00.000Z",
};

const FAILED: ConnectedDevice = {
  ...UNPLUGGED,
  id: "00000000-0000-4000-8000-0000000000d4",
  name: "ESP32",
  kind: "serial-usb",
  disconnectedBecause: "error",
  disconnectedBy: null,
  problem: "The helper ended.",
};

/** A socket that opens at once and is never written to by the service. */
class OpenSocket extends EventTarget {
  readyState = 0;
  binaryType = "blob";

  constructor() {
    super();
    queueMicrotask(() => {
      this.readyState = 1;
      this.dispatchEvent(new Event("open"));
    });
  }

  send(): void {}

  close(code?: number): void {
    this.readyState = 3;
    this.dispatchEvent(Object.assign(new Event("close"), { code: code ?? 1005 }));
  }
}

function answers(project: Project, devices: readonly ConnectedDevice[]): Answers {
  return {
    [`GET /api/projects/${project.id}`]: () => ({ status: 200, body: project }),
    [`GET /api/tasks/${TASK.id}/devices`]: () => ({ status: 200, body: { devices } }),
    [`POST /api/devices/${PHONE.id}/disconnect`]: () => ({
      status: 200,
      body: { ...PHONE, state: "disconnected", disconnectedBecause: "by-user" },
    }),
  };
}

async function blockOf(): Promise<HTMLElement> {
  const { page } = await openPage("/", { "/": () => <DevicesBlock task={TASK} /> });
  return page;
}

describe("the Devices section", () => {
  afterEach(closePage);

  it("isn't shown while the Project's Run environment is Off", async () => {
    const sent = stubService(answers({ ...PROJECT, runEnvironment: "off" }, [PHONE]));
    const page = await blockOf();

    await until(() =>
      expect(sent.map(({ request }) => request)).toContain(`GET /api/projects/${PROJECT.id}`),
    );
    expect(page.querySelector('[aria-label="Devices"]')).toBeNull();
    expect(sent.map(({ request }) => request)).not.toContain(`GET /api/tasks/${TASK.id}/devices`);
  });

  it("shows each device's kind, state, who connected it, and the Disconnected ones with why", async () => {
    stubService(answers(PROJECT, [PHONE, BOARD, UNPLUGGED, FAILED]));
    const page = await blockOf();

    await until(() => expect(page.querySelector('[aria-label="Pixel 8"]')).not.toBeNull());
    const phone = shownText(page.querySelector('[aria-label="Pixel 8"]')!);
    expect(phone).toContain("Android phone over USB");
    expect(phone).toContain("Connected");
    expect(phone).toContain("connected by Ann Lee");
    expect(phone).toContain("adb serial 127.0.0.1:5555");
    const board = shownText(page.querySelector('[aria-label="Arduino Uno"]')!);
    expect(board).toContain("Serial board over USB");
    expect(board).toContain("Waiting for the run environment");
    expect(shownText(page)).toContain("2 connected");

    expect(page.querySelector('[aria-label="Old phone"]')).toBeNull();
    act(() => buttonNamed(page, "Disconnected · 2")?.click());
    expect(shownText(page.querySelector('[aria-label="Old phone"]')!)).toContain("by Ann Lee");
    expect(shownText(page.querySelector('[aria-label="ESP32"]')!)).toContain(
      "error: The helper ended.",
    );
  });

  it("disconnects a device through its route", async () => {
    const sent = stubService(answers(PROJECT, [PHONE]));
    const page = await blockOf();
    await until(() => expect(buttonNamed(page, "Disconnect")).toBeDefined());

    act(() => buttonNamed(page, "Disconnect")?.click());

    await until(() =>
      expect(sent.map(({ request }) => request)).toContain(
        `POST /api/devices/${PHONE.id}/disconnect`,
      ),
    );
    await until(() => expect(shownText(document.body)).toContain("Pixel 8 disconnected."));
  });

  it("offers an Android phone over USB, greyed with why in a browser without WebUSB", async () => {
    stubService(answers(PROJECT, []));
    const page = await blockOf();
    await until(() => expect(buttonNamed(page, "Connect over USB")).toBeDefined());

    act(() => buttonNamed(page, "Connect over USB")?.click());

    const why = window.isSecureContext === false ? NEEDS_SECURE_CONTEXT : NEEDS_WEBUSB;
    const option = buttonNamed(
      page.querySelector('[role="menu"]')!,
      `Android phone over USB${why}`,
    );
    expect(option?.disabled).toBe(true);
    expect(shownText(page)).toContain(KEEP_TAB_OPEN);
  });

  it("hints at USB debugging after the picker closes with no phone picked", async () => {
    const unregister = registerDeviceTransport({
      kind: "android-usb",
      request: () => Promise.resolve(undefined),
    });
    try {
      stubService(answers(PROJECT, []));
      const page = await blockOf();
      await until(() => expect(buttonNamed(page, "Connect over USB")).toBeDefined());

      act(() => buttonNamed(page, "Connect over USB")?.click());
      act(() => buttonNamed(page, "Android phone over USB")?.click());

      await until(() => expect(shownText(page)).toContain(USB_DEBUGGING_HINT));
    } finally {
      unregister();
    }
  });

  it("shows why the browser couldn't open the phone as the refusal", async () => {
    const unregister = registerDeviceTransport({
      kind: "android-usb",
      request: () => Promise.reject(new Error(PHONE_IN_USE)),
    });
    try {
      const sent = stubService(answers(PROJECT, []));
      const page = await blockOf();
      await until(() => expect(buttonNamed(page, "Connect over USB")).toBeDefined());

      act(() => buttonNamed(page, "Connect over USB")?.click());
      act(() => buttonNamed(page, "Android phone over USB")?.click());

      await until(() => expect(shownText(page)).toContain("The device wasn't connected"));
      expect(shownText(page)).toContain(PHONE_IN_USE);
      expect(sent.map(({ request }) => request)).not.toContain(
        `POST /api/tasks/${TASK.id}/devices`,
      );
    } finally {
      unregister();
    }
  });

  it("shows on the phone's row what it asks the user, while it asks", async () => {
    vi.stubGlobal("WebSocket", OpenSocket);
    let tell: ((notice: string | undefined) => void) | undefined;
    const phone: RequestedDevice = {
      name: "Pixel 8",
      deviceKey: "usb:18d1:4ee7:serial",
      attach: () => ({ opened: () => {}, received: () => {}, closed: () => {}, end: () => {} }),
      onUnplugged: () => () => {},
      onNotice: (listener) => {
        tell = listener;
        return () => (tell = undefined);
      },
    };
    const unregister = registerDeviceTransport({
      kind: "android-usb",
      request: () => Promise.resolve(phone),
    });
    try {
      stubService({
        ...answers(PROJECT, [PHONE]),
        [`POST /api/tasks/${TASK.id}/devices`]: () => ({ status: 201, body: PHONE }),
      });
      const page = await blockOf();
      await until(() => expect(buttonNamed(page, "Connect over USB")).toBeDefined());

      act(() => buttonNamed(page, "Connect over USB")?.click());
      act(() => buttonNamed(page, "Android phone over USB")?.click());
      await until(() => expect(tell).toBeDefined());

      act(() => tell?.(ALLOW_USB_DEBUGGING));
      const row = (): string => shownText(page.querySelector('[aria-label="Pixel 8"]')!);
      expect(row()).toContain(ALLOW_USB_DEBUGGING);

      act(() => tell?.(undefined));
      expect(row()).not.toContain(ALLOW_USB_DEBUGGING);
    } finally {
      unregister();
      closeEveryDeviceRelay();
    }
  });

  it("offers each kind with a registered transport in the Connect menu", async () => {
    // A browser with WebUSB.
    Object.defineProperty(navigator, "usb", { value: new EventTarget(), configurable: true });
    const unregister = registerDeviceTransport({
      kind: "serial-usb",
      request: () => Promise.resolve(undefined),
    });
    try {
      stubService(answers(PROJECT, []));
      const page = await blockOf();
      await until(() => expect(buttonNamed(page, "Connect over USB")).toBeDefined());

      act(() => buttonNamed(page, "Connect over USB")?.click());

      const menu = page.querySelector('[role="menu"]');
      expect(menu === null ? [] : [...menu.querySelectorAll("button")].map(shownText)).toEqual([
        "Android phone over USB",
        "Serial board over USB",
      ]);
    } finally {
      unregister();
      Reflect.deleteProperty(navigator, "usb");
    }
  });

  it("names the other Task, linked, when the device is connected there", async () => {
    const unregister = registerDeviceTransport({
      kind: "android-usb",
      request: () =>
        Promise.resolve({
          name: "Pixel 8",
          deviceKey: "18d1:4ee7:serial",
          attach: () => ({ opened: () => {}, received: () => {}, closed: () => {}, end: () => {} }),
          onUnplugged: () => () => {},
        }),
    });
    try {
      const sent = stubService({
        ...answers(PROJECT, []),
        [`POST /api/tasks/${TASK.id}/devices`]: () => ({
          status: 409,
          body: {
            statusCode: 409,
            message: "Pixel 8 is connected to Flash the bootloader.",
            reasons: ["Pixel 8 is connected to Flash the bootloader."],
            otherTask: { id: "other-task", title: "Flash the bootloader" },
          },
        }),
      });
      const page = await blockOf();
      await until(() => expect(buttonNamed(page, "Connect over USB")).toBeDefined());

      act(() => buttonNamed(page, "Connect over USB")?.click());
      act(() => buttonNamed(page, "Android phone over USB")?.click());

      await until(() => expect(shownText(page)).toContain("The device wasn't connected"));
      expect(
        sent.find(({ request }) => request === `POST /api/tasks/${TASK.id}/devices`)?.body,
      ).toEqual({ kind: "android-usb", name: "Pixel 8", deviceKey: "18d1:4ee7:serial" });
      expect(shownText(page)).toContain(
        "Pixel 8 is connected to Flash the bootloader. Disconnect it there first.",
      );
      expect(page.querySelector('a[href="/tasks/other-task"]')?.textContent).toBe(
        "Flash the bootloader",
      );
    } finally {
      unregister();
    }
  });
});
