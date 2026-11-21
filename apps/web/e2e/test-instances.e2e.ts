import { execFileSync } from "node:child_process";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  DEFAULT_TEST_INSTANCE_SETTINGS,
  ideaSchema,
  initiativeBranchOf,
  initiativeTestInstancesSchema,
  projectSchema,
  type EditedTestTarget,
  type NewProject,
  type Project,
  type TestInstanceSettings,
} from "@the-office/contracts";
import { NOT_SIGNED_IN } from "./e2e-user.ts";
import { queryOfficeDatabase } from "./office-database.ts";
import { screenshotScenario } from "./task-screenshots.ts";
import {
  commitFiles,
  createTemporaryRepository,
  type TemporaryRepository,
} from "./temporary-repository.ts";

// Every file shares test_instance_settings and the Proxy ports: this file alone changes them, one
// test after the other, and gives the defaults back.
test.describe.configure({ mode: "serial" });
test.use({ colorScheme: "light", viewport: { width: 1600, height: 900 } });

/**
 * Proxy ports beside the e2e service's own (4390, 4391), clear of the defaults (4400–4419) that a
 * real Office on the same host may be using for its own test instances.
 */
const E2E_PROXY_PORTS = { firstProxyPort: 4396, lastProxyPort: 4399 } as const;

/** What the e2e service's one test instance app says (`apps/service/src/e2e.ts`). */
const APP_LINE = "Hello from the test instance";

/** A branch a Hosted test instance can run: a valid `.devcontainer/` and its entry point. */
const BRANCH_FILES = {
  ".devcontainer/devcontainer.json":
    '{ "dockerComposeFile": "compose.yaml", "service": "app", "overrideCommand": true }',
  ".devcontainer/compose.yaml": "services:\n  app:\n    image: node:22\n",
  "scripts/start.sh": "#!/bin/sh\nexec node server.js\n",
};

const TARGET: EditedTestTarget = {
  key: "web",
  name: "Shop web app",
  kind: "hosted",
  entryPoint: { kind: "repository-file", path: "scripts/start.sh", arguments: [] },
  port: 3000,
  variables: [],
  secretVariables: [],
  commandsBefore: [],
  portVariable: "PORT",
  memoryMegabytes: null,
};

async function saveSettings(page: Page, settings: TestInstanceSettings): Promise<void> {
  const saved = await page.request.put("/api/settings/test-instances", { data: settings });
  expect(saved.status()).toBe(200);
}

/** The Office limits card, by its own first row. */
function limitsCard(page: Page): Locator {
  return page.locator("section:not(:has(section))", { hasText: "Test instances at once" });
}

test("Office limits' Test instances card saves the three limits and refuses a port out of range", async ({
  page,
}) => {
  try {
    await page.goto("/settings/office-limits");
    const card = limitsCard(page);
    const atOnce = card.getByRole("status", { name: "test instances at once" });
    const idle = card.getByRole("status", { name: "the Idle time" });
    const first = card.getByLabel("First proxy port");
    const last = card.getByLabel("Last proxy port");
    await expect(atOnce).toHaveText("2");
    await expect(idle).toHaveText("30 min");
    await expect(first).toHaveValue("4400");
    await expect(last).toHaveValue("4419");
    await expect(card).toContainText("20 ports");

    await card.getByRole("button", { name: "Raise test instances at once" }).click();
    await expect(atOnce).toHaveText("3");
    await card.getByRole("button", { name: "Raise the Idle time" }).click();
    await expect(idle).toHaveText("35 min");
    await first.fill(String(E2E_PROXY_PORTS.firstProxyPort));
    await first.press("Enter");
    await expect(card).toContainText("24 ports");
    await last.fill(String(E2E_PROXY_PORTS.lastProxyPort));
    await last.press("Enter");
    await expect(card).toContainText("4 ports");

    await page.reload();
    await expect(atOnce).toHaveText("3");
    await expect(idle).toHaveText("35 min");
    await expect(first).toHaveValue("4396");
    await expect(last).toHaveValue("4399");
    await screenshotScenario(page, "test-instances-card", { inView: card });

    // Out of range: refused before it is sent, the field marked.
    const refusal = card.getByRole("status").filter({
      hasText: "The test instances' limits can't be saved",
    });
    await last.fill("70000");
    await last.press("Enter");
    await expect(refusal).toContainText(
      "Last proxy port: A Proxy port is a whole number from 1024 to 65535.",
    );
    await expect(last).toHaveAttribute("aria-invalid", "true");
    await expect(first).toHaveAttribute("aria-invalid", "false");

    // The service's own refusal: a range holding The Office's own port.
    await last.fill("4399");
    await first.fill("4385");
    await first.press("Enter");
    await expect(refusal).toContainText(
      "First proxy port: The Proxy ports can't hold The Office's own port, 4390.",
    );
    await expect(first).toHaveAttribute("aria-invalid", "true");

    await page.reload();
    await expect(first).toHaveValue("4396");
    await expect(refusal).toHaveCount(0);
  } finally {
    await saveSettings(page, DEFAULT_TEST_INSTANCE_SETTINGS);
  }
});

/** An active Initiative with its branch in the Project, seeded as Confirm would leave it. */
async function activeInitiative(
  page: Page,
  project: Project,
  repository: TemporaryRepository,
  name: string,
): Promise<string> {
  const idea = await page.request.post("/api/ideas", {
    data: { title: name, notes: "", projectId: project.id },
  });
  expect(idea.status()).toBe(201);
  const initiativeId = crypto.randomUUID();
  const shortName = `instances-${Date.now().toString(36)}`;
  execFileSync("git", ["branch", initiativeBranchOf(shortName), "main"], {
    cwd: repository.path,
  });
  await queryOfficeDatabase(
    `insert into initiatives (id, name, outcome, state, origin_idea_id, created_by, created_at, short_name, branches)
     values ($1, $2, '', 'active', $3, $4, now(), $5, $6)`,
    [
      initiativeId,
      name,
      ideaSchema.parse(await idea.json()).id,
      { kind: "user" },
      shortName,
      JSON.stringify([{ projectId: project.id, madeAt: new Date().toISOString() }]),
    ],
  );
  return initiativeId;
}

async function hostedProject(page: Page, repository: TemporaryRepository): Promise<Project> {
  const newProject: NewProject = {
    name: `Test instances shop ${Date.now()}`,
    path: repository.path,
    baseBranch: "main",
    mark: { label: "TI", colour: "teal" },
    installCommand: "npm ci",
    commands: [
      {
        key: "build",
        name: "Build",
        kind: "build",
        commandLine: "npm run build",
        rerunCommandLine: "",
      },
      {
        key: "lint",
        name: "Lint",
        kind: "lint",
        commandLine: "npm run lint",
        rerunCommandLine: "",
      },
      { key: "test", name: "Test", kind: "test", commandLine: "npm test", rerunCommandLine: "" },
    ],
    installInputs: [],
    publishingMode: "push-and-pull-request",
    defaultPipeline: "full",
  };
  const added = await page.request.post("/api/projects", { data: newProject });
  expect(added.status(), await added.text()).toBe(201);
  const project = projectSchema.parse(await added.json());
  const on = await page.request.put(`/api/projects/${project.id}/run-environment`, {
    data: { runEnvironment: "on" },
  });
  expect(on.status(), await on.text()).toBe(200);
  const targets = await page.request.put(`/api/projects/${project.id}/test-targets`, {
    data: { targets: [TARGET] },
  });
  expect(targets.status(), await targets.text()).toBe(200);
  return project;
}

test("the Initiative page launches a Hosted test instance, opens it, shows its log and stops it", async ({
  page,
  context,
}) => {
  const repository = await createTemporaryRepository();
  let initiativeId: string | undefined;
  try {
    await commitFiles(repository, BRANCH_FILES);
    const project = await hostedProject(page, repository);
    initiativeId = await activeInitiative(page, project, repository, "Try the shop on its branch");
    await saveSettings(page, { ...DEFAULT_TEST_INSTANCE_SETTINGS, ...E2E_PROXY_PORTS });

    await page.goto(`/work/initiatives/${initiativeId}`);
    const block = page.locator('section[aria-label="Test instances"]');
    const head = block.locator(".record-fold-head");
    await expect(head).toContainText("None launched yet");
    if ((await head.getAttribute("aria-expanded")) !== "true") await head.click();
    const group = block.locator(`section[aria-label="${project.name}"]`);
    const row = group
      .getByRole("list", { name: `Test targets in ${project.name}` })
      .getByRole("listitem", { name: TARGET.name });
    await expect(row).toContainText("Not launched yet");

    await row.getByRole("button", { name: "Launch", exact: true }).click();
    await expect(row).toContainText("Running", { timeout: 30_000 });
    const port = E2E_PROXY_PORTS.firstProxyPort;
    await expect(row.locator(".test-instance-address")).toHaveText(`localhost:${port}`);
    await expect(head).toContainText("1 running");
    await screenshotScenario(page, "test-instances-block", { inView: block });

    // Open hands the new tab off to the instance's own address, then the app's page.
    const [tab] = await Promise.all([
      context.waitForEvent("page"),
      row.getByRole("button", { name: "Open", exact: true }).click(),
    ]);
    await tab.waitForURL(`http://localhost:${port}/`);
    await expect(tab.getByRole("heading", { name: APP_LINE })).toBeVisible();
    await tab.close();

    await row.getByRole("button", { name: "Log", exact: true }).click();
    const logWindow = page.getByRole("dialog", { name: `${TARGET.name} · Running` });
    const log = logWindow.getByRole("log", { name: `${TARGET.name}'s log` });
    // The Office's own lines are marked, the app's output is plain.
    await expect(log.locator(".is-office").last()).toHaveText("The app answers on port 3000.");
    await expect(log.locator(".is-output", { hasText: APP_LINE })).toHaveCount(1);
    // Follow, the window's one switch (the design system's Switch names none).
    await expect(logWindow.getByRole("switch")).toBeChecked();
    await screenshotScenario(page, "test-instance-log", { inView: logWindow });
    await logWindow.getByRole("button", { name: "Close", exact: true }).click();
    await expect(logWindow).toHaveCount(0);

    await row.getByRole("button", { name: "Stop", exact: true }).click();
    await expect(page.getByText(`${TARGET.name} stopped.`)).toBeVisible();
    await expect(row).toContainText("Stopped");
    await expect(row.getByRole("button", { name: "Launch again" })).toBeVisible();
    await expect(row.getByRole("button", { name: "Open", exact: true })).toHaveCount(0);
    await expect(head).toContainText("None running");
  } finally {
    if (initiativeId !== undefined) await stopEvery(page, initiativeId);
    await saveSettings(page, DEFAULT_TEST_INSTANCE_SETTINGS);
    await repository.remove();
  }
});

/** Stops whatever the test left Building or Running, so its Proxy port is free again. */
async function stopEvery(page: Page, initiativeId: string): Promise<void> {
  const read = await page.request.get(`/api/initiatives/${initiativeId}/test-instances`);
  const { projects } = initiativeTestInstancesSchema.parse(await read.json());
  for (const instance of projects.flatMap(({ targets }) =>
    targets.flatMap(({ instances }) => instances),
  )) {
    if (instance.state === "building" || instance.state === "running") {
      await page.request.post(`/api/test-instances/${instance.id}/stop`);
    }
  }
}

/** The file the build writes, as an Android build writes its APK. */
const BUILT_FILE = "app-debug.apk";

/**
 * A branch a Build to install target builds on the workstation: its package script runs a Node
 * script of the repository that writes the output file, so the build really runs and makes it.
 */
const BUILD_BRANCH_FILES = {
  "package.json": JSON.stringify({
    name: "shop-app",
    private: true,
    scripts: { build: "node scripts/build.mjs" },
  }),
  "scripts/build.mjs": [
    'import { mkdirSync, writeFileSync } from "node:fs";',
    'mkdirSync("out", { recursive: true });',
    `writeFileSync("out/${BUILT_FILE}", "not really an APK");`,
    `console.log("Built out/${BUILT_FILE}");`,
    "",
  ].join("\n"),
};

const BUILD_TARGET: EditedTestTarget = {
  key: "android",
  name: "Shop Android app",
  kind: "build-to-install",
  entryPoint: { kind: "package-script", manifest: "package.json", script: "build", arguments: [] },
  outputPatterns: ["out/*.apk"],
  variables: [],
  secretVariables: [],
  commandsBefore: [],
  memoryMegabytes: null,
};

/** A Project with its Run environment Off, so its build runs on the workstation. */
async function buildProject(page: Page, repository: TemporaryRepository): Promise<Project> {
  const newProject: NewProject = {
    name: `Test builds shop ${Date.now()}`,
    path: repository.path,
    baseBranch: "main",
    mark: { label: "TB", colour: "violet" },
    installCommand: "npm ci",
    commands: [
      { key: "test", name: "Test", kind: "test", commandLine: "npm test", rerunCommandLine: "" },
    ],
    installInputs: [],
    publishingMode: "push-and-pull-request",
    defaultPipeline: "full",
  };
  const added = await page.request.post("/api/projects", { data: newProject });
  expect(added.status(), await added.text()).toBe(201);
  const project = projectSchema.parse(await added.json());
  const targets = await page.request.put(`/api/projects/${project.id}/test-targets`, {
    data: { targets: [BUILD_TARGET] },
  });
  expect(targets.status(), await targets.text()).toBe(200);
  return project;
}

test("the Initiative page builds a Build to install test instance, downloads its file and shows its QR code", async ({
  page,
}) => {
  const repository = await createTemporaryRepository();
  let initiativeId: string | undefined;
  try {
    await commitFiles(repository, BUILD_BRANCH_FILES);
    const project = await buildProject(page, repository);
    initiativeId = await activeInitiative(page, project, repository, "Try the shop's Android app");

    await page.goto(`/work/initiatives/${initiativeId}`);
    const block = page.locator('section[aria-label="Test instances"]');
    const head = block.locator(".record-fold-head");
    await expect(head).toContainText("None launched yet");
    if ((await head.getAttribute("aria-expanded")) !== "true") await head.click();
    const group = block.locator(`section[aria-label="${project.name}"]`);
    // A build needs no Run environment: nothing holds its Launch.
    await expect(group).not.toContainText("Needs Run environment On to launch.");
    const row = group
      .getByRole("list", { name: `Test targets in ${project.name}` })
      .getByRole("listitem", { name: BUILD_TARGET.name });
    await expect(row).toContainText("Build to install");

    await row.getByRole("button", { name: "Launch", exact: true }).click();
    await expect(row).toContainText("Built", { timeout: 60_000 });
    await expect(head).toContainText("1 built");
    await expect(row.getByRole("button", { name: "Open", exact: true })).toHaveCount(0);
    const file = row.getByRole("listitem", { name: BUILT_FILE });
    await screenshotScenario(page, "build-to-install-built", { inView: block });

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      file.getByRole("link", { name: "Download" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe(BUILT_FILE);

    // At localhost, which a phone can't reach, the window says to use the LAN address instead.
    await file.getByRole("button", { name: "QR code" }).click();
    const qrWindow = page.getByRole("dialog", { name: `Install ${BUILT_FILE} on a phone` });
    await expect(qrWindow).toContainText("A phone can't reach localhost.");
    await expect(qrWindow.getByRole("img")).toHaveCount(0);
    await qrWindow.getByRole("button", { name: "Close", exact: true }).click();
    await expect(qrWindow).toHaveCount(0);

    // Opened at a LAN address, the service answers a link, which the window draws as a QR code.
    const url = `http://192.168.1.20:4390/api/sign-in/test-builds/e2e`;
    await page.route("**/files/*/link", (route) =>
      route.fulfill({
        json: { kind: "link", url, expiresAt: new Date(Date.now() + 3_600_000).toISOString() },
      }),
    );
    await file.getByRole("button", { name: "QR code" }).click();
    await expect(
      qrWindow.getByRole("img", { name: `The QR code for ${BUILT_FILE}` }),
    ).toBeVisible();
    await expect(qrWindow).toContainText("Works for this file only, for 1 hour.");
    await expect(qrWindow).toContainText(url);
    await screenshotScenario(page, "build-to-install-qr", { inView: qrWindow });
  } finally {
    if (initiativeId !== undefined) await stopEvery(page, initiativeId);
    await repository.remove();
  }
});

function banner(page: Page): Locator {
  return page.getByRole("note", { name: "Test instance" });
}

/** /api/health as a test instance of The Office answers it; the e2e service is a normal Office. */
async function answerAsTestInstance(page: Page): Promise<void> {
  await page.route("**/api/health", (route) =>
    route.fulfill({ json: { database: "up", testInstance: true } }),
  );
}

test("the Test instance banner shows on every page of a test instance, and on no other", async ({
  page,
  browser,
}, testInfo) => {
  await page.goto("/work");
  await expect(page.getByRole("navigation").first()).toBeVisible();
  await expect(banner(page)).toHaveCount(0);

  await answerAsTestInstance(page);
  await page.reload();
  await expect(banner(page)).toContainText("This Office runs from an Initiative's branch");
  await expect(banner(page)).toContainText("OFFICE_TEST_INSTANCE");
  await screenshotScenario(page, "test-instance-banner-shell");

  const signedOut = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
    storageState: NOT_SIGNED_IN,
    colorScheme: "light",
    viewport: { width: 1600, height: 900 },
  });
  try {
    const signIn = await signedOut.newPage();
    await answerAsTestInstance(signIn);
    await signIn.goto("/sign-in");
    await expect(banner(signIn)).toBeVisible();
    await expect(signIn.getByRole("form", { name: "Sign in with a password" })).toBeVisible();
    await screenshotScenario(signIn, "test-instance-banner-sign-in");
  } finally {
    await signedOut.close();
  }
});
