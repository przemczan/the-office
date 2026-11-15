import type { SignInRefusal } from "@the-office/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  closeSignInPage,
  formNamed,
  openSignInPage,
  stubService,
  submitted,
  typed,
  until,
} from "./sign-in-page.fixtures.tsx";

const SIGN_IN_PAGE = { firstRun: false, ways: [{ kind: "password" }], unavailable: [] };

async function triedPassword(
  path: string,
  answer: { status: number; body: unknown },
): Promise<Awaited<ReturnType<typeof openSignInPage>>> {
  stubService({
    "GET /api/sign-in": () => ({ status: 200, body: SIGN_IN_PAGE }),
    "POST /api/sign-in/password": () => answer,
  });
  const opened = await openSignInPage(path);
  await until(() => expect(formNamed(opened.page, "Sign in with a password")).not.toBeNull());
  typed(opened.page, "Email", "ada@example.com");
  typed(opened.page, "Password", "not the password");
  submitted(formNamed(opened.page, "Sign in with a password"));
  return opened;
}

function refused(refusal: SignInRefusal): { status: number; body: SignInRefusal } {
  return { status: refusal.statusCode, body: refusal };
}

function submitButton(page: HTMLElement): HTMLButtonElement | null {
  return page.querySelector<HTMLButtonElement>('button[type="submit"]');
}

afterEach(() => {
  closeSignInPage();
  vi.useRealTimers();
});

describe("signing in with a password", () => {
  it("says a wrong email or password is wrong, and lets the user try again", async () => {
    const { page } = await triedPassword(
      "/sign-in",
      refused({ statusCode: 422, message: "The email or password is wrong.", refusal: "wrong" }),
    );

    await until(() => expect(page.textContent).toContain("The email or password is wrong."));
    expect(page.textContent).not.toContain("Try again");
    expect(submitButton(page)?.disabled).toBe(false);
  });

  it("counts down a short wait before the next try, the button waiting meanwhile", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-13T14:00:00.000Z"));
    const { page } = await triedPassword(
      "/sign-in",
      refused({
        statusCode: 429,
        message: "Too many wrong tries in a row: wait a moment before the next one.",
        refusal: "slow-down",
        tryAgainAt: "2026-11-13T14:00:16.000Z",
      }),
    );

    await until(() => expect(page.textContent).toContain("Try again in 16 seconds."));
    expect(page.textContent).toContain("wait a moment before the next one");
    expect(submitButton(page)?.disabled).toBe(true);
  });

  it("names when a lockout ends", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 13, 14, 0));
    const { page } = await triedPassword(
      "/sign-in",
      refused({
        statusCode: 429,
        message: "Too many wrong tries: signing in with a password is locked for a while.",
        refusal: "locked",
        tryAgainAt: new Date(2026, 10, 13, 14, 15).toISOString(),
      }),
    );

    await until(() => expect(page.textContent).toContain("Try again at 14:15."));
  });

  it("returns to the page asked for once signed in", async () => {
    const { router } = await triedPassword("/sign-in?returnTo=%2Fwork", {
      status: 200,
      body: { outcome: "signed-in" },
    });

    await until(() => expect(router.state.location.pathname).toBe("/work"));
  });

  it("returns home rather than to another site", async () => {
    const { page } = await triedPassword("/sign-in?returnTo=%2F%2Fevil.example%2Fwork", {
      status: 200,
      body: { outcome: "signed-in" },
    });

    await until(() => expect(page.textContent).toContain("Home"));
  });
});

describe("the first user", () => {
  it("lists every reason the service refused them", async () => {
    stubService({
      "GET /api/sign-in": () => ({ status: 200, body: { ...SIGN_IN_PAGE, firstRun: true } }),
      "POST /api/sign-in/first-user": () => ({
        status: 422,
        body: {
          statusCode: 422,
          message: "Give a name. A password has at least 12 characters.",
          reasons: ["Give a name.", "A password has at least 12 characters."],
        },
      }),
    });
    const { page } = await openSignInPage("/sign-in");
    await until(() => expect(formNamed(page, "Create the first user")).not.toBeNull());
    typed(page, "Setup token", "office-setup-token");
    typed(page, "Name", " ");
    typed(page, "Email", "ada@example.com");
    typed(page, "Password", "short");
    submitted(formNamed(page, "Create the first user"));

    await until(() => expect(page.textContent).toContain("The first user can't be created"));
    expect([...page.querySelectorAll(".refusal-reasons li")].map((li) => li.textContent)).toEqual([
      "Give a name.",
      "A password has at least 12 characters.",
    ]);
  });

  it("offers signing in once someone else created the first user meanwhile", async () => {
    let firstRun = true;
    stubService({
      "GET /api/sign-in": () => ({ status: 200, body: { ...SIGN_IN_PAGE, firstRun } }),
      "POST /api/sign-in/first-user": () => {
        firstRun = false;
        return { status: 409, body: { statusCode: 409, message: "The first user exists." } };
      },
    });
    const { page } = await openSignInPage("/sign-in");
    await until(() => expect(formNamed(page, "Create the first user")).not.toBeNull());
    typed(page, "Setup token", "office-setup-token");
    typed(page, "Name", "Ada");
    typed(page, "Email", "ada@example.com");
    typed(page, "Password", "twelve chars or more");
    submitted(formNamed(page, "Create the first user"));

    await until(() => expect(formNamed(page, "Sign in with a password")).not.toBeNull());
    expect(page.querySelector("h1")?.textContent).toBe("Sign in to The Office");
  });
});
