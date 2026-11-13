import { createMemoryHistory, createRouter } from "@tanstack/react-router";
import type { Account, SignInPage } from "@the-office/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./app.tsx";
import { router as officeRouter, type OfficeRouter } from "./router.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// The shell itself is the shell's tests'; here it only says it is shown.
vi.mock("./shell/shell.tsx", () => ({ Shell: () => <p>The shell</p> }));

const SIGN_IN_PAGE: SignInPage = { firstRun: false, ways: [{ kind: "password" }], unavailable: [] };
const ADA: Account = {
  id: "5d1c2b3a-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
  name: "Ada",
  email: "ada@x.io",
  appearance: { palette: null, density: null },
};
const SIGNED_OUT = { statusCode: 401, message: "Sign in to The Office first." };

/** A WebSocket the service would answer; the test closes it as the service would. */
class FakeWebSocket extends EventTarget {
  constructor(readonly url: string) {
    super();
  }

  send(): void {}

  close(): void {}
}

/** What the service answers, by method and path; anything else is answered 401, signed out. */
type Answers = Record<string, () => { readonly status: number; readonly body?: unknown }>;

let answers: Answers;
let sockets: FakeWebSocket[];
let root: Root | undefined;

function answer(more: Answers): void {
  answers = { ...answers, ...more };
}

function stubService(): void {
  answers = {};
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const key = `${init?.method ?? "GET"} ${String(input)}`;
      const { status, body } = answers[key]?.() ?? { status: 401, body: SIGNED_OUT };
      return body === undefined ? new Response(null, { status }) : Response.json(body, { status });
    }),
  );
}

async function opened(path: string): Promise<{ page: HTMLElement; router: OfficeRouter }> {
  sockets = [];
  const router: OfficeRouter = createRouter({
    routeTree: officeRouter.routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  const page = document.createElement("div");
  document.body.append(page);
  await act(async () => {
    root = createRoot(page);
    root.render(
      <App
        router={router}
        openWebSocket={(url) => {
          const socket = new FakeWebSocket(url);
          sockets.push(socket);
          return socket as unknown as WebSocket;
        }}
      />,
    );
  });
  return { page, router };
}

/** Lets the page answer until `check` holds. */
async function until(check: () => void): Promise<void> {
  await vi.waitFor(async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    check();
  });
}

function typed(page: HTMLElement, selector: string, text: string): void {
  const input = page.querySelector<HTMLInputElement>(selector);
  if (!input) throw new Error(`There is no ${selector}.`);
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setValue?.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function where(router: OfficeRouter): { readonly pathname: string; readonly search: unknown } {
  const { pathname, search } = router.state.location;
  return { pathname, search };
}

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("signing in", () => {
  it("shows the sign-in page alone, outside the shell, with no WebSocket", async () => {
    stubService();
    answer({ "GET /api/sign-in": () => ({ status: 200, body: SIGN_IN_PAGE }) });

    const { page } = await opened("/sign-in");

    await until(() => expect(page.querySelector("h1")?.textContent).toBe("Sign in to The Office"));
    expect(page.textContent).not.toContain("The shell");
    expect(page.querySelector("nav")).toBeNull();
    expect(sockets).toHaveLength(0);
  });

  it("sends a browser that isn't signed in to the sign-in page, which returns to the page asked for, then connects", async () => {
    stubService();
    answer({ "GET /api/sign-in": () => ({ status: 200, body: SIGN_IN_PAGE }) });

    const { page, router } = await opened("/projects?chat=ada");

    await until(() =>
      expect(where(router)).toEqual({
        pathname: "/sign-in",
        search: { returnTo: "/projects?chat=ada" },
      }),
    );
    expect(page.textContent).not.toContain("The shell");
    expect(sockets).toHaveLength(0);

    await until(() => expect(page.querySelector('input[type="password"]')).not.toBeNull());
    answer({
      "POST /api/sign-in/password": () => ({ status: 200, body: { outcome: "signed-in" } }),
      "GET /api/account": () => ({ status: 200, body: ADA }),
    });
    typed(page, 'input[type="email"]', "ada@x.io");
    typed(page, 'input[type="password"]', "a long enough password");
    act(() => page.querySelector<HTMLButtonElement>('button[type="submit"]')?.click());

    await until(() => expect(page.textContent).toContain("The shell"));
    expect(where(router)).toEqual({ pathname: "/projects", search: { chat: "ada" } });
    expect(sockets.map((socket) => socket.url)).toEqual([expect.stringMatching(/\/api\/events$/)]);
  });

  it("goes to the sign-in page when the service closes the event stream as this device was signed out", async () => {
    stubService();
    answer({
      "GET /api/account": () => ({ status: 200, body: ADA }),
      "GET /api/sign-in": () => ({ status: 200, body: SIGN_IN_PAGE }),
    });
    const { page, router } = await opened("/people");
    await until(() => expect(sockets).toHaveLength(1));

    act(() => {
      sockets[0]?.dispatchEvent(new CloseEvent("close", { code: 4401 }));
    });

    await until(() =>
      expect(where(router)).toEqual({ pathname: "/sign-in", search: { returnTo: "/people" } }),
    );
    expect(page.textContent).not.toContain("The shell");
    expect(sockets).toHaveLength(1);
  });
});

describe("the account", () => {
  it("is where Settings › Appearance went, since palette and density are each user's own", async () => {
    stubService();
    answer({ "GET /api/account": () => ({ status: 200, body: ADA }) });

    const { router } = await opened("/settings/appearance");

    await until(() => expect(where(router).pathname).toBe("/account/appearance"));
  });

  it("opens at its profile", async () => {
    stubService();
    answer({ "GET /api/account": () => ({ status: 200, body: ADA }) });

    const { router } = await opened("/account");

    await until(() => expect(where(router).pathname).toBe("/account/profile"));
  });
});
