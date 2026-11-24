import { createMemoryHistory, createRouter } from "@tanstack/react-router";
import type {
  Account,
  EngineAccount,
  EngineSettings,
  FirstRunSetup,
  GitHubState,
  TelemetrySettings,
} from "@the-office/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./app.tsx";
import { router as officeRouter, type OfficeRouter } from "./router.tsx";
import { buttonNamed, until } from "./shell/page.fixtures.tsx";

// The shell itself is the shell's tests'; here it only says it is shown.
vi.mock("./shell/shell.tsx", () => ({ Shell: () => <p>The shell</p> }));

const ADA: Account = {
  id: "5d1c2b3a-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
  name: "Ada",
  email: "ada@x.io",
  appearance: { palette: null, density: null },
  authenticator: { state: "off" },
};
const CLAUDE_CODE: EngineSettings = {
  engines: [
    {
      id: "claude-code",
      name: "Claude Code",
      kind: "claude-code",
      defaultModel: "claude-opus",
      defaultEffort: null,
      claudeCodeP: false,
    },
  ],
  officeDefault: { engineType: "claude-code", engineId: "claude-code" },
  searchEndpoint: null,
  modelPrices: [],
  standInEngines: [],
  askBeforeSwitchAbove: 100_000,
  windowStarts: [],
  modelLists: [],
  timeZone: "UTC",
};
const AN_API_ENGINE: EngineSettings = {
  engines: [
    {
      id: "local",
      name: "Local models",
      kind: "openai-compatible-api",
      defaultModel: "qwen",
      defaultEffort: null,
      baseUrl: "http://127.0.0.1:8080/v1",
      keySet: false,
      models: [{ id: "qwen", contextWindow: 32_000, seesImages: false }],
    },
  ],
  officeDefault: { engineType: "openai-compatible-api", engineId: "local" },
  searchEndpoint: null,
  modelPrices: [],
  standInEngines: [],
  askBeforeSwitchAbove: 100_000,
  windowStarts: [],
  modelLists: [],
  timeZone: "UTC",
};
const SIGNED_OUT_OF_CLAUDE: EngineAccount = {
  signedIn: false,
  pastedToken: false,
  apiKey: false,
  email: null,
  plan: null,
};
const NOT_REGISTERED: GitHubState = { status: "not-registered" };
const TELEMETRY_OFF: TelemetrySettings = {
  saved: { kind: "off" },
  running: { kind: "off" },
  setByEnvironment: false,
  appliesAtNextStart: false,
  bundledGrafana: { state: "not-wanted", address: "http://localhost:3300", earlierStopped: [] },
};

/** A WebSocket the service would answer, quiet throughout. */
class FakeWebSocket extends EventTarget {
  send(): void {}

  close(): void {}
}

type Answers = Record<string, () => { readonly status: number; readonly body?: unknown }>;

let root: Root | undefined;
let basics: FirstRunSetup["basics"];
let sent: string[];

/** The service with First-run setup's basics as `open`, its cards' reads, and `more`. */
function stubService(open: FirstRunSetup["basics"], more: Answers = {}): void {
  basics = open;
  sent = [];
  const answers: Answers = {
    "GET /api/account": () => ({ status: 200, body: ADA }),
    "GET /api/first-run-setup": () => ({ status: 200, body: { basics } }),
    "POST /api/first-run-setup/close": () => {
      basics = "closed";
      return { status: 204 };
    },
    "GET /api/settings/engines": () => ({ status: 200, body: CLAUDE_CODE }),
    "GET /api/settings/engines/claude-code/account": () => ({
      status: 200,
      body: SIGNED_OUT_OF_CLAUDE,
    }),
    "GET /api/github": () => ({ status: 200, body: NOT_REGISTERED }),
    "GET /api/settings/telemetry": () => ({ status: 200, body: TELEMETRY_OFF }),
    "PUT /api/settings/telemetry": () => ({ status: 200, body: TELEMETRY_OFF }),
    ...more,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const key = `${init?.method ?? "GET"} ${String(input)}`;
      sent.push(key);
      const answer = answers[key]?.() ?? { status: 404, body: { message: "Not here." } };
      return answer.body === undefined
        ? new Response(null, { status: answer.status })
        : Response.json(answer.body, { status: answer.status });
    }),
  );
}

async function opened(path: string): Promise<{ page: HTMLElement; router: OfficeRouter }> {
  const router: OfficeRouter = createRouter({
    routeTree: officeRouter.routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  const page = document.createElement("div");
  document.body.append(page);
  await act(async () => {
    root = createRoot(page);
    root.render(
      <App router={router} openWebSocket={() => new FakeWebSocket() as unknown as WebSocket} />,
    );
  });
  return { page, router };
}

function where(router: OfficeRouter): { readonly pathname: string; readonly search: unknown } {
  const { pathname, search } = router.state.location;
  return { pathname, search };
}

function heading(page: HTMLElement): string | null | undefined {
  return page.querySelector("h2")?.textContent;
}

function press(page: HTMLElement, name: string): void {
  const button = buttonNamed(page, name);
  if (!button) throw new Error(`There is no ${name} button.`);
  act(() => button.click());
}

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("First-run setup", () => {
  it("sends every signed-in page to its first step while the basics are open, outside the shell", async () => {
    stubService("open");

    const { page, router } = await opened("/projects?chat=ada");

    await until(() => expect(where(router)).toEqual({ pathname: "/setup", search: {} }));
    await until(() => expect(heading(page)).toBe("Engine"));
    expect(page.querySelector("h1")?.textContent).toBe("First-run setup");
    expect(page.textContent).not.toContain("The shell");
    expect(page.textContent).toContain("Step 1 of 3");
    expect(page.querySelector('[aria-current="step"]')?.textContent).toContain("Engine");
  });

  it("signs the Office default Claude Code engine in on its engine step", async () => {
    stubService("open");

    const { page } = await opened("/setup");

    await until(() => expect(page.querySelector('[aria-label="Account"]')).not.toBeNull());
    expect(page.textContent).toContain("Claude Code, a Claude Code engine.");
    expect(buttonNamed(page, "Sign in")).toBeDefined();
    expect(buttonNamed(page, "Paste a token instead")).toBeDefined();
  });

  it("links to Settings › Engines when the Office default is an API engine, which stays reachable", async () => {
    stubService("open", {
      "GET /api/settings/engines": () => ({ status: 200, body: AN_API_ENGINE }),
    });
    const { page, router } = await opened("/setup?step=engine");
    await until(() => expect(page.textContent).toContain("Local models, an API endpoint"));

    const link = [...page.querySelectorAll("a")].find(
      (anchor) => anchor.textContent === "Settings › Engines",
    );
    act(() => link?.click());

    await until(() => expect(where(router).pathname).toBe("/settings/engines"));
    await until(() => expect(page.textContent).toContain("The shell"));
  });

  it("walks the steps with Skip and Next, then Finish closes it and lands on Now, for good", async () => {
    stubService("open");
    const { page, router } = await opened("/setup");
    await until(() => expect(heading(page)).toBe("Engine"));

    press(page, "Skip");
    await until(() => expect(heading(page)).toBe("Sign in with GitHub"));
    expect(where(router)).toEqual({ pathname: "/setup", search: { step: "github" } });
    expect(page.textContent).toContain("Step 2 of 3");
    await until(() => expect(page.textContent).toContain("Register the GitHub App"));

    press(page, "Next");
    await until(() => expect(heading(page)).toBe("Telemetry"));
    expect(page.textContent).toContain("Step 3 of 3");
    expect(buttonNamed(page, "Next")).toBeUndefined();
    expect(buttonNamed(page, "Skip the rest")).toBeUndefined();
    await until(() => expect(page.textContent).toContain("Now: telemetry is off."));
    expect(sent).not.toContain("POST /api/first-run-setup/close");

    press(page, "Finish");

    await until(() => expect(where(router).pathname).toBe("/now"));
    await until(() => expect(page.textContent).toContain("The shell"));
    expect(sent.filter((request) => request === "POST /api/first-run-setup/close")).toHaveLength(1);
    // Read again once closed, so nothing sends the page back.
    expect(sent.filter((request) => request === "GET /api/first-run-setup").length).toBeGreaterThan(
      1,
    );
    expect(where(router).pathname).toBe("/now");
  });

  it("closes from any step with Skip the rest", async () => {
    stubService("open");
    const { page, router } = await opened("/setup?step=github");
    await until(() => expect(heading(page)).toBe("Sign in with GitHub"));

    press(page, "Skip the rest");

    await until(() => expect(where(router).pathname).toBe("/now"));
    expect(sent).toContain("POST /api/first-run-setup/close");
  });

  it("finishes once the telemetry choice is saved on the last step", async () => {
    stubService("open");
    const { page, router } = await opened("/setup?step=telemetry");
    await until(() => expect(buttonNamed(page, "Save")).toBeDefined());

    press(page, "Save");

    await until(() => expect(where(router).pathname).toBe("/now"));
    expect(sent).toContain("PUT /api/settings/telemetry");
    expect(sent).toContain("POST /api/first-run-setup/close");
  });

  it("lands GitHub's return to Settings › Office identity on the GitHub step, with why it failed", async () => {
    stubService("open");

    const { page, router } = await opened(
      "/settings/office-identity?signInFailed=GitHub%20said%20no.",
    );

    await until(() =>
      expect(where(router)).toEqual({
        pathname: "/setup",
        search: { step: "github", signInFailed: "GitHub said no." },
      }),
    );
    await until(() => expect(page.textContent).toContain("Signing in with GitHub failed"));
    expect(page.textContent).toContain("GitHub said no.");
  });

  it("sends its own page home once the basics are closed, and leaves the other pages be", async () => {
    stubService("closed");

    const { page, router } = await opened("/setup?step=github");

    await until(() => expect(where(router).pathname).toBe("/now"));
    await until(() => expect(page.textContent).toContain("The shell"));
    expect(sent).not.toContain("POST /api/first-run-setup/close");
  });
});
