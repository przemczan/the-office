import type { Account, SignInPage } from "@the-office/contracts";
import { afterEach, describe, expect, it } from "vitest";
import {
  closeSignInPage,
  formNamed,
  openSignInPage,
  stubService,
  submitted,
  typed,
  until,
} from "./sign-in-page.fixtures.tsx";
import { SIGN_IN_WAYS } from "./sign-in-ways.tsx";

function signInPage(page: SignInPage): () => { status: number; body: SignInPage } {
  return () => ({ status: 200, body: page });
}

afterEach(closeSignInPage);

describe("the sign-in page", () => {
  it("offers only the ways the service lists for this address", async () => {
    stubService({ "GET /api/sign-in": signInPage({ firstRun: false, ways: [], unavailable: [] }) });

    const { page } = await openSignInPage("/sign-in");

    await until(() => expect(page.querySelector("h1")?.textContent).toBe("Sign in to The Office"));
    expect(page.querySelectorAll("form")).toHaveLength(0);
  });

  it("draws the password way when it is listed, each kind by its own view", async () => {
    stubService({
      "GET /api/sign-in": signInPage({
        firstRun: false,
        ways: [{ kind: "password" }],
        unavailable: [],
      }),
    });

    const { page } = await openSignInPage("/sign-in");

    await until(() => expect(formNamed(page, "Sign in with a password")).not.toBeNull());
    expect(page.querySelectorAll("form")).toHaveLength(1);
    expect(Object.keys(SIGN_IN_WAYS)).toEqual(["password", "passkey", "github"]);
  });

  it("asks for the first user at first run, and signs them in", async () => {
    const sent = stubService({
      "GET /api/sign-in": signInPage({
        firstRun: true,
        ways: [{ kind: "password" }],
        unavailable: [],
      }),
      "POST /api/sign-in/first-user": () => ({ status: 201, body: { outcome: "signed-in" } }),
    });

    const { page, router } = await openSignInPage("/sign-in?returnTo=%2Fwork");

    await until(() => expect(page.querySelector("h1")?.textContent).toBe("Create the first user"));
    expect(formNamed(page, "Sign in with a password")).toBeNull();
    const form = formNamed(page, "Create the first user");
    typed(page, "Name", "Ada Lovelace");
    typed(page, "Email", "ada@example.com");
    typed(page, "Password", "twelve chars or more");
    submitted(form);

    await until(() => expect(router.state.location.pathname).toBe("/work"));
    expect(sent.find(({ request }) => request === "POST /api/sign-in/first-user")?.body).toEqual({
      name: "Ada Lovelace",
      email: "ada@example.com",
      password: "twelve chars or more",
    });
  });

  it("goes on to setting a new user's own password after their one-time password, then signs in with their appearance", async () => {
    const grace: Account = {
      id: "6e2d3c4b-5f6a-4b7c-9d8e-0f1a2b3c4d5e",
      name: "Grace",
      email: "grace@example.com",
      appearance: { palette: "mocha", density: "compact" },
      authenticator: { state: "off" },
    };
    const sent = stubService({
      "GET /api/sign-in": signInPage({
        firstRun: false,
        ways: [{ kind: "password" }],
        unavailable: [],
      }),
      "POST /api/sign-in/password": () => ({ status: 200, body: { outcome: "set-password" } }),
      "POST /api/sign-in/set-password": () => ({ status: 200, body: { outcome: "signed-in" } }),
      "GET /api/account": () => ({ status: 200, body: grace }),
    });
    const { page, router } = await openSignInPage("/sign-in?returnTo=%2Fwork");
    await until(() => expect(formNamed(page, "Sign in with a password")).not.toBeNull());

    typed(page, "Email", "grace@example.com");
    typed(page, "Password", "ABCD-EFGH-JKMN-PQRS");
    submitted(formNamed(page, "Sign in with a password"));

    await until(() => expect(formNamed(page, "Set your password")).not.toBeNull());
    const form = formNamed(page, "Set your password");
    typed(page, "New password", "my very own password");
    typed(page, "Repeat the new password", "my very own passwore");
    expect(page.textContent).toContain("The two passwords differ.");
    expect(form?.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
    typed(page, "Repeat the new password", "my very own password");
    submitted(form);

    await until(() => expect(router.state.location.pathname).toBe("/work"));
    expect(sent.find(({ request }) => request === "POST /api/sign-in/set-password")?.body).toEqual({
      email: "grace@example.com",
      oneTimePassword: "ABCD-EFGH-JKMN-PQRS",
      password: "my very own password",
    });
    // Read before leaving, so the shell's first paint is already the user's own.
    expect(document.documentElement.dataset.palette).toBe("mocha");
    expect(document.documentElement.dataset.density).toBe("compact");
  });
});
