import type { ConnectedDevice, Project, ProjectDevice, Task } from "@the-office/contracts";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerDeviceTransport, type RequestedDevice } from "../../api/device-relay.ts";
import { NEEDS_WEB_SERIAL, serialUsbTransport } from "../../api/device-transports/serial-usb.ts";
import {
  buttonNamed,
  closePage,
  openPage,
  shownText,
  stubService,
  until,
  type Answers,
} from "../../shell/page.fixtures.tsx";
import {
  ALLOW_USB_DEBUGGING,
  NEEDS_SECURE_CONTEXT,
  NEEDS_WEBUSB,
  PHONE_IN_USE,
  USB_DEBUGGING_HINT,
} from "../../shell/devices/android-usb/android-usb-words.ts";
import { closeEveryDeviceRelay } from "../../shell/devices/device-relays.ts";
import { KEEP_TAB_OPEN } from "../../shell/devices/device-words.ts";
import { BY_ANN } from "../../shell/user.fixtures.ts";
import { deviceNoticeWords } from "./device-words.ts";
import { DevicesBlock } from "./devices-block.tsx";

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
  engine: null,
  initiativeEngine: null,
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
  deleteMergedBranches: false,
  environment: { set: [], unset: [], prependPath: [] },
  useProjectSkills: true,
  projectSkillsOff: [],
  engine: {
    default: null,
    force: null,
    people: [],
    standIns: { useOwnList: false, engineIds: [] },
  },
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

const PHONE: ConnectedDevice = {
  id: "00000000-0000-4000-8000-0000000000d1",
  taskId: TASK.id,
  projectDeviceId: null,
  kind: "android-usb",
  name: "Pixel 8",
  state: "connected",
  disconnectedBecause: null,
  disconnectedBy: null,
  problem: null,
  endpoint: "127.0.0.1:5555",
  rfc2217Url: null,
  baudRate: null,
  roundTripMs: null,
  notices: [],
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

  it("isn't shown while the Project's Connected devices are switched off", async () => {
    const sent = stubService(
      answers({ ...PROJECT, features: { ...PROJECT.features, "connected-devices": false } }, [
        PHONE,
      ]),
    );
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
    // The button is in the section's head, shown before the devices are read; the note isn't.
    await until(() => expect(shownText(page)).toContain(KEEP_TAB_OPEN));

    act(() => buttonNamed(page, "Connect a device")?.click());

    const why = window.isSecureContext === false ? NEEDS_SECURE_CONTEXT : NEEDS_WEBUSB;
    const option = buttonNamed(
      page.querySelector('[role="menu"]')!,
      `Android phone over USB${why}`,
    );
    expect(option?.disabled).toBe(true);
  });

  it("hints at USB debugging after the picker closes with no phone picked", async () => {
    const unregister = registerDeviceTransport({
      kind: "android-usb",
      request: () => Promise.resolve(undefined),
    });
    try {
      stubService(answers(PROJECT, []));
      const page = await blockOf();
      await until(() => expect(buttonNamed(page, "Connect a device")).toBeDefined());

      act(() => buttonNamed(page, "Connect a device")?.click());
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
      await until(() => expect(buttonNamed(page, "Connect a device")).toBeDefined());

      act(() => buttonNamed(page, "Connect a device")?.click());
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
      await until(() => expect(buttonNamed(page, "Connect a device")).toBeDefined());

      act(() => buttonNamed(page, "Connect a device")?.click());
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
      await until(() => expect(buttonNamed(page, "Connect a device")).toBeDefined());

      act(() => buttonNamed(page, "Connect a device")?.click());

      const menu = page.querySelector('[role="menu"]');
      expect(menu === null ? [] : [...menu.querySelectorAll("button")].map(shownText)).toEqual([
        "Android phone over USB",
        "Serial board over USB",
        "Pair over wireless debugging",
      ]);
    } finally {
      unregister();
      Reflect.deleteProperty(navigator, "usb");
    }
  });

  it("greys the serial board's choice, saying why, in a browser without Web Serial", async () => {
    const unregister = registerDeviceTransport(serialUsbTransport(undefined, () => true));
    try {
      stubService(answers(PROJECT, []));
      const page = await blockOf();
      await until(() => expect(buttonNamed(page, "Connect a device")).toBeDefined());

      act(() => buttonNamed(page, "Connect a device")?.click());

      const choice = buttonNamed(
        page.querySelector('[role="menu"]')!,
        `Serial board over USB${NEEDS_WEB_SERIAL}`,
      );
      expect(choice?.disabled).toBe(true);
    } finally {
      unregister();
    }
  });

  it("shows a serial board's path, RFC 2217 address, baud and round trip once Connected", async () => {
    stubService(
      answers(PROJECT, [
        {
          ...BOARD,
          state: "connected",
          endpoint: "/dev/ttyACM0",
          rfc2217Url: "rfc2217://127.0.0.1:2217",
          baudRate: 115_200,
          roundTripMs: 40,
        },
      ]),
    );
    const page = await blockOf();

    await until(() => expect(page.querySelector('[aria-label="Arduino Uno"]')).not.toBeNull());
    const board = page.querySelector('[aria-label="Arduino Uno"]')!;
    expect([...board.querySelectorAll("code")].map((code) => code.textContent)).toEqual([
      "/dev/ttyACM0",
      "rfc2217://127.0.0.1:2217",
    ]);
    expect(shownText(board)).toContain("115200 baud · round trip 40 ms");
  });

  it("shows only the path of a serial board without an RFC 2217 address", async () => {
    stubService(answers(PROJECT, [{ ...BOARD, state: "connected", endpoint: "/dev/ttyACM0" }]));
    const page = await blockOf();

    await until(() => expect(page.querySelector('[aria-label="Arduino Uno"]')).not.toBeNull());
    const board = page.querySelector('[aria-label="Arduino Uno"]')!;
    expect([...board.querySelectorAll("code")].map((code) => code.textContent)).toEqual([
      "/dev/ttyACM0",
    ]);
  });

  it("says each of a serial board's notices in words", async () => {
    stubService(
      answers(PROJECT, [
        {
          ...BOARD,
          state: "connected",
          endpoint: "/dev/ttyACM0",
          baudRate: 115_200,
          roundTripMs: 320,
          notices: [
            "slow-round-trip",
            "no-answer-after-reset",
            "touch-1200",
            "esptool-sync-no-answer",
            "no-upload-tool",
            "port-busy",
          ],
        },
      ]),
    );
    const page = await blockOf();

    await until(() => expect(page.querySelector('[aria-label="Arduino Uno"]')).not.toBeNull());
    const notices = [
      ...page.querySelectorAll('[aria-label="What to know about Arduino Uno"] li'),
    ].map((notice) => [notice.getAttribute("data-tone"), shownText(notice)]);
    expect(notices).toEqual([
      ["warning", "Uploads will be slow: each step waits 320 ms for the round trip."],
      [
        "warning",
        "The board didn't answer after its reset; its bootloader may not wait for the 320 ms round trip. Press its reset button as the upload starts.",
      ],
      [
        "warning",
        "This board resets into a new USB device to upload (1200-baud touch, as Leonardo and Micro do); that isn't carried through the browser.",
      ],
      [
        "warning",
        "esptool's automatic reset isn't carried on this port. Hold BOOT, tap reset, and upload with --before no_reset.",
      ],
      [
        "info",
        "Neither avrdude nor arduino-cli is in the run environment's image; add the Project's upload tool to .devcontainer.",
      ],
      [
        "warning",
        "The board is busy: one tool at a time can have it open, at /dev/ttyACM0. Close the other one first.",
      ],
    ]);
  });

  it("points esptool and the busy board at the RFC 2217 address when the board has one", () => {
    const board = {
      roundTripMs: 40,
      endpoint: "/dev/ttyACM0",
      rfc2217Url: "rfc2217://127.0.0.1:2217",
    };

    expect(deviceNoticeWords("esptool-sync-no-answer", board)).toBe(
      "Use --port rfc2217://127.0.0.1:2217 for esptool's automatic reset, or hold BOOT, tap reset and upload with --before no_reset.",
    );
    expect(deviceNoticeWords("port-busy", board)).toBe(
      "The board is busy: one tool at a time can have it open, at /dev/ttyACM0 or at rfc2217://127.0.0.1:2217. Close the other one first.",
    );
    expect(deviceNoticeWords("port-busy", { ...board, endpoint: null, rfc2217Url: null })).toBe(
      "The board is busy: one tool at a time can have it open. Close the other one first.",
    );
  });

  it("leaves the round trip out of a notice's words until it is measured", () => {
    expect(
      deviceNoticeWords("slow-round-trip", {
        roundTripMs: null,
        endpoint: null,
        rfc2217Url: null,
      }),
    ).toBe("Uploads will be slow: each step waits for the round trip.");
  });

  it("names the other Task, linked, when the device is connected there, and lets it go", async () => {
    let released = 0;
    const unregister = registerDeviceTransport({
      kind: "android-usb",
      request: () =>
        Promise.resolve({
          name: "Pixel 8",
          deviceKey: "18d1:4ee7:serial",
          attach: () => ({ opened: () => {}, received: () => {}, closed: () => {}, end: () => {} }),
          release: () => (released += 1),
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
      await until(() => expect(buttonNamed(page, "Connect a device")).toBeDefined());

      act(() => buttonNamed(page, "Connect a device")?.click());
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
      expect(released).toBe(1);
    } finally {
      unregister();
    }
  });
});

const LENT_PHONE: ProjectDevice = {
  id: "00000000-0000-4000-8000-0000000000f1",
  projectId: PROJECT.id,
  kind: "android-wireless",
  deviceKey: "wireless:192.168.1.20",
  name: "Lab phone",
  address: "192.168.1.20",
  port: 37_099,
  state: "paired",
  inUseBy: null,
  pairingStep: null,
  pairingProblem: null,
  addedBy: BY_ANN,
  addedAt: "2026-11-20T09:00:00.000Z",
  lastUse: null,
};

const HELD_BOARD: ProjectDevice = {
  ...LENT_PHONE,
  id: "00000000-0000-4000-8000-0000000000f2",
  kind: "serial-usb",
  deviceKey: "serial:2341:0043:abc",
  name: "Bench Uno",
  address: null,
  port: null,
  state: "in-use",
  inUseBy: { kind: "task", taskId: "other-task", title: "Flash the bootloader" },
};

const USB_PHONE: ProjectDevice = {
  ...LENT_PHONE,
  id: "00000000-0000-4000-8000-0000000000f3",
  kind: "android-usb",
  deviceKey: "usb:18d1:4ee7:serial",
  name: "Desk Pixel",
  address: null,
  port: null,
  state: "over-usb",
};

const LEND_PATH = `POST /api/tasks/${TASK.id}/devices/lend`;

function withProjectDevices(answered: Answers, devices: readonly ProjectDevice[]): Answers {
  return {
    ...answered,
    [`GET /api/projects/${PROJECT.id}/devices`]: () => ({ status: 200, body: { devices } }),
  };
}

function useMenu(page: HTMLElement): HTMLElement {
  act(() => buttonNamed(page, "Use a Project device")?.click());
  const menu = page.querySelector<HTMLElement>('[role="menu"]');
  if (menu === null) throw new Error("Use a Project device opened no menu.");
  return menu;
}

function choiceNamed(menu: HTMLElement, name: string): HTMLButtonElement | undefined {
  return [...menu.querySelectorAll("button")].find((button) => shownText(button).startsWith(name));
}

describe("Use a Project device", () => {
  afterEach(closePage);

  it("lists the Project's devices with their kind and state, one in use elsewhere disabled", async () => {
    stubService(withProjectDevices(answers(PROJECT, []), [LENT_PHONE, HELD_BOARD]));
    const page = await blockOf();
    await until(() => expect(buttonNamed(page, "Use a Project device")).toBeDefined());

    const menu = useMenu(page);
    await until(() => expect(choiceNamed(menu, "Lab phone")).toBeDefined());
    const phone = choiceNamed(menu, "Lab phone")!;
    expect(shownText(phone)).toContain("Android phone over wireless debugging");
    expect(shownText(phone)).toContain("Paired");
    expect(phone.disabled).toBe(false);
    const board = choiceNamed(page.querySelector('[role="menu"]')!, "Bench Uno")!;
    expect(board.disabled).toBe(true);
    expect(shownText(board)).toContain("In use by Flash the bootloader");
  });

  it("lends a phone over wireless debugging to the Task", async () => {
    const lent: ConnectedDevice = {
      ...PHONE,
      kind: "android-wireless",
      name: "Lab phone",
      state: "connecting",
      endpoint: "192.168.1.20:37099",
      projectDeviceId: LENT_PHONE.id,
    };
    const sent = stubService({
      ...withProjectDevices(answers(PROJECT, []), [LENT_PHONE]),
      [LEND_PATH]: () => ({ status: 201, body: lent }),
    });
    const page = await blockOf();
    await until(() => expect(buttonNamed(page, "Use a Project device")).toBeDefined());

    let menu = useMenu(page);
    await until(() => {
      menu = page.querySelector<HTMLElement>('[role="menu"]')!;
      expect(choiceNamed(menu, "Lab phone")).toBeDefined();
    });
    act(() => choiceNamed(menu, "Lab phone")?.click());

    await until(() => expect(shownText(document.body)).toContain("Lab phone connected."));
    expect(sent.find(({ request }) => request === LEND_PATH)?.body).toEqual({
      projectDeviceId: LENT_PHONE.id,
    });
  });

  it("opens a device over USB this browser allowed before without its picker", async () => {
    vi.stubGlobal("WebSocket", OpenSocket);
    const request = vi.fn<() => Promise<RequestedDevice | undefined>>(() =>
      Promise.resolve(undefined),
    );
    const remembered = vi.fn<(deviceKey: string) => Promise<RequestedDevice | undefined>>(
      (deviceKey) =>
        Promise.resolve<RequestedDevice>({
          name: "Pixel 8",
          deviceKey,
          attach: () => ({ opened: () => {}, received: () => {}, closed: () => {}, end: () => {} }),
          onUnplugged: () => () => {},
        }),
    );
    const unregister = registerDeviceTransport({ kind: "android-usb", request, remembered });
    try {
      const lent: ConnectedDevice = {
        ...PHONE,
        name: "Desk Pixel",
        state: "connecting",
        endpoint: null,
        projectDeviceId: USB_PHONE.id,
      };
      const sent = stubService({
        ...withProjectDevices(answers(PROJECT, []), [USB_PHONE]),
        [LEND_PATH]: () => ({ status: 201, body: lent }),
      });
      const page = await blockOf();
      await until(() => expect(buttonNamed(page, "Use a Project device")).toBeDefined());

      let menu = useMenu(page);
      await until(() => {
        menu = page.querySelector<HTMLElement>('[role="menu"]')!;
        expect(choiceNamed(menu, "Desk Pixel")?.disabled).toBe(false);
      });
      act(() => choiceNamed(menu, "Desk Pixel")?.click());

      await until(() => expect(shownText(document.body)).toContain("Desk Pixel connected."));
      expect(remembered).toHaveBeenCalledWith("usb:18d1:4ee7:serial");
      expect(request).not.toHaveBeenCalled();
      expect(sent.map(({ request: sentRequest }) => sentRequest)).toContain(LEND_PATH);
    } finally {
      unregister();
      closeEveryDeviceRelay();
    }
  });

  it("says when the Project has no devices, with a way to add one", async () => {
    stubService(withProjectDevices(answers(PROJECT, []), []));
    const page = await blockOf();
    await until(() => expect(buttonNamed(page, "Use a Project device")).toBeDefined());

    useMenu(page);
    await until(() =>
      expect(shownText(page.querySelector('[role="menu"]')!)).toContain(
        "Admin panel has no devices yet.",
      ),
    );
    expect(
      buttonNamed(page.querySelector('[role="menu"]')!, "Add one under Devices"),
    ).toBeDefined();
  });

  it("says where a lent device came from, and gives it back on Disconnect", async () => {
    const lent: ConnectedDevice = { ...PHONE, projectDeviceId: USB_PHONE.id };
    stubService({
      ...withProjectDevices(answers(PROJECT, [lent]), [USB_PHONE]),
      [`POST /api/devices/${PHONE.id}/disconnect`]: () => ({
        status: 200,
        body: { ...lent, state: "disconnected", disconnectedBecause: "by-user" },
      }),
    });
    const page = await blockOf();
    await until(() => expect(page.querySelector('[aria-label="Pixel 8"]')).not.toBeNull());

    const from = [...page.querySelectorAll("a")].find(
      (link) => link.textContent === "From Admin panel's devices",
    );
    expect(from?.getAttribute("href")).toBe(`/projects/${PROJECT.id}/devices`);

    act(() => buttonNamed(page, "Disconnect")?.click());
    await until(() =>
      expect(shownText(document.body)).toContain("Pixel 8 given back to Admin panel's devices."),
    );
  });
});
