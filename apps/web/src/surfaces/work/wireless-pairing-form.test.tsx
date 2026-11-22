import type { ConnectedDevice, Project, Task } from "@the-office/contracts";
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
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
import {
  disconnectedWhy,
  PAIR_WIRELESS_ERRORS,
  PAIRING_STARTS_RUN_ENVIRONMENT,
} from "./device-words.ts";
import { DevicesBlock } from "./devices-block.tsx";
import { wirelessPairingOf } from "./wireless-pairing-form.tsx";

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
  features: {
    "connected-devices": true,
    "test-targets": true,
    "github-issues": true,
    "run-environment": true,
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

const PAIRED: ConnectedDevice = {
  id: "00000000-0000-4000-8000-0000000000e1",
  taskId: TASK.id,
  kind: "android-wireless",
  name: "192.168.1.20:37099",
  state: "connecting",
  disconnectedBecause: null,
  disconnectedBy: null,
  problem: null,
  endpoint: "192.168.1.20:37099",
  rfc2217Url: null,
  baudRate: null,
  roundTripMs: null,
  notices: [],
  connectedBy: BY_ANN,
  connectedAt: "2026-11-20T09:30:00.000Z",
  disconnectedAt: null,
};

const PAIR_PATH = `POST /api/tasks/${TASK.id}/devices/wireless`;

function answers(pairAnswer: Answers[string]): Answers {
  return {
    [`GET /api/projects/${PROJECT.id}`]: () => ({ status: 200, body: PROJECT }),
    [`GET /api/tasks/${TASK.id}/devices`]: () => ({ status: 200, body: { devices: [] } }),
    [PAIR_PATH]: pairAnswer,
  };
}

/** Opens the Devices section and its pairing window from the Connect menu. */
async function pairingWindow(): Promise<void> {
  const { page } = await openPage("/", { "/": () => <DevicesBlock task={TASK} /> });
  await until(() => expect(buttonNamed(page, "Connect a device")).toBeDefined());
  act(() => buttonNamed(page, "Connect a device")?.click());
  const item = buttonNamed(page.querySelector('[role="menu"]')!, "Pair over wireless debugging");
  expect(item?.disabled).toBe(false);
  act(() => item?.click());
  await until(() => expect(fieldLabelled("Pairing code")).toBeDefined());
}

function fieldLabelled(label: string): HTMLInputElement | undefined {
  const labelElement = [...document.body.querySelectorAll("label")].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  const input = labelElement && document.getElementById(labelElement.htmlFor);
  return input instanceof HTMLInputElement ? input : undefined;
}

function fill(fields: Readonly<Record<string, string>>): void {
  for (const [label, text] of Object.entries(fields)) typed(document.body, label, text);
}

function pair(): void {
  act(() => buttonNamed(document.body, "Pair")?.click());
}

const GOOD = {
  "IP address": "192.168.1.20",
  Port: "37099",
  "Pairing port": "41235",
  "Pairing code": "482913",
};

describe("pairing a phone over wireless debugging", () => {
  afterEach(closePage);

  it("is offered without WebUSB, with its fields, their help and the run environment line", async () => {
    stubService(answers(() => ({ status: 201, body: PAIRED })));
    await pairingWindow();

    const code = fieldLabelled("Pairing code");
    expect(code?.getAttribute("autocomplete")).toBe("one-time-code");
    expect(code?.getAttribute("inputmode")).toBe("numeric");
    for (const label of ["IP address", "Port", "Pairing port"])
      expect(fieldLabelled(label)).toBeDefined();
    const shown = shownText(document.body);
    expect(shown).toContain("Pair device with pairing code. Used once, never kept.");
    expect(shown).toContain(PAIRING_STARTS_RUN_ENVIRONMENT);
  });

  it("says what is missing or wrong in each field, and sends nothing", async () => {
    const sent = stubService(answers(() => ({ status: 201, body: PAIRED })));
    await pairingWindow();

    pair();
    let shown = shownText(document.body);
    expect(shown).toContain(PAIR_WIRELESS_ERRORS.noAddress);
    expect(shown).toContain(PAIR_WIRELESS_ERRORS.noPort);
    expect(shown).toContain(PAIR_WIRELESS_ERRORS.noPairingCode);

    fill({
      "IP address": "phone.local",
      Port: "70000",
      "Pairing port": "4a",
      "Pairing code": "12345",
    });
    pair();
    shown = shownText(document.body);
    expect(shown).toContain(PAIR_WIRELESS_ERRORS.badAddress);
    expect(shown).toContain(PAIR_WIRELESS_ERRORS.badPort);
    expect(shown).toContain(PAIR_WIRELESS_ERRORS.badPairingCode);
    expect(sent.map(({ request }) => request)).not.toContain(PAIR_PATH);
  });

  it("sends the pairing, clears the code, and closes once the record is made", async () => {
    const sent = stubService(answers(() => ({ status: 201, body: PAIRED })));
    await pairingWindow();
    fill(GOOD);

    pair();
    expect(fieldLabelled("Pairing code")?.value).toBe("");
    await until(() => expect(sent.map(({ request }) => request)).toContain(PAIR_PATH));
    expect(sent.find(({ request }) => request === PAIR_PATH)?.body).toEqual({
      address: "192.168.1.20",
      port: 37_099,
      pairingPort: 41_235,
      pairingCode: "482913",
    });
    await until(() => expect(fieldLabelled("IP address")).toBeUndefined());
    expect(shownText(document.body)).toContain("Pairing with the phone at 192.168.1.20…");
  });

  it("shows the service's reasons and clears the code after a refusal", async () => {
    stubService(
      answers(() => ({
        status: 422,
        body: {
          statusCode: 422,
          message: "Use the phone's address on your network, not a link-local one.",
          reasons: ["Use the phone's address on your network, not a link-local one."],
          otherTask: null,
        },
      })),
    );
    await pairingWindow();
    fill(GOOD);
    pair();

    await until(() => expect(shownText(document.body)).toContain("The device wasn't connected"));
    expect(shownText(document.body)).toContain(
      "Use the phone's address on your network, not a link-local one.",
    );
    expect(fieldLabelled("Pairing code")?.value).toBe("");
    expect(fieldLabelled("IP address")?.value).toBe("192.168.1.20");
  });

  it("names the other Task, linked, when the phone is connected there", async () => {
    stubService(
      answers(() => ({
        status: 409,
        body: {
          statusCode: 409,
          message: "The phone is connected to Flash the bootloader.",
          reasons: ["The phone is connected to Flash the bootloader."],
          otherTask: { id: "other-task", title: "Flash the bootloader" },
        },
      })),
    );
    await pairingWindow();
    fill(GOOD);
    pair();

    await until(() =>
      expect(shownText(document.body)).toContain(
        "The phone at 192.168.1.20 is connected to Flash the bootloader. Disconnect it there first.",
      ),
    );
    expect(document.body.querySelector('a[href="/tasks/other-task"]')?.textContent).toBe(
      "Flash the bootloader",
    );
  });
});

describe("the pairing the fields make", () => {
  it("takes ports from 1 to 65535, an IPv6 address and a code with a space in it", () => {
    expect(
      wirelessPairingOf({
        address: " fd00::20 ",
        port: "1",
        pairingPort: "65535",
        pairingCode: "482 913",
      }),
    ).toEqual({
      pairing: { address: "fd00::20", port: 1, pairingPort: 65_535, pairingCode: "482913" },
    });
    expect(
      wirelessPairingOf({
        address: "10.0.0.2",
        port: "0",
        pairingPort: "5",
        pairingCode: "1234567",
      }),
    ).toEqual({
      errors: {
        port: PAIR_WIRELESS_ERRORS.badPort,
        pairingCode: PAIR_WIRELESS_ERRORS.badPairingCode,
      },
    });
  });
});

describe("why a phone over wireless debugging is Disconnected", () => {
  it("gives the record's problem when it ended as device unplugged", () => {
    expect(
      disconnectedWhy(
        {
          disconnectedBecause: "device-unplugged",
          disconnectedBy: null,
          problem: "The phone didn't answer at 192.168.1.20:37099; pair it again.",
        },
        () => "",
      ),
    ).toBe("device unplugged: The phone didn't answer at 192.168.1.20:37099; pair it again.");
    expect(
      disconnectedWhy(
        { disconnectedBecause: "device-unplugged", disconnectedBy: null, problem: null },
        () => "",
      ),
    ).toBe("device unplugged");
  });
});
