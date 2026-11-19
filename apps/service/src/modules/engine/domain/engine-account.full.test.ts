import { describe, expect, it } from "vitest";
import {
  codexEngineAccountOf,
  engineAccountOf,
  EngineAccountUnreadable,
} from "./engine-account.js";

/** What the 2.1.310 binary printed for an empty folder, as task 47's step 1e read it. */
const SIGNED_OUT = JSON.stringify({
  loggedIn: false,
  authMethod: "none",
  apiProvider: "firstParty",
  analyticsDisabled: false,
  projectsDirectory: "C:/office-data/engines/claude-code/projects",
  configDirectory: "C:/office-data/engines/claude-code",
});

describe("an engine's account, read from `claude auth status --json`", () => {
  it("is signed out when the binary says so", () => {
    expect(engineAccountOf(`${SIGNED_OUT}\n`, false)).toEqual({ signedIn: false });
  });

  it("gives the email and the plan when signed in", () => {
    const status = { loggedIn: true, email: "ada@example.com", subscriptionType: "max" };

    expect(engineAccountOf(JSON.stringify(status), false)).toEqual({
      signedIn: true,
      pastedToken: false,
      apiKey: false,
      email: "ada@example.com",
      plan: "max",
    });
  });

  it("leaves out what the binary doesn't tell as text", () => {
    const status = { loggedIn: true, email: "", subscriptionType: null, authMethod: "claude.ai" };

    expect(engineAccountOf(JSON.stringify(status), false)).toEqual({
      signedIn: true,
      pastedToken: false,
      apiKey: false,
      email: undefined,
      plan: undefined,
    });
  });

  it("tells a pasted token signs it in, with no email or plan an earlier Sign in left", () => {
    const status = { loggedIn: true, email: "ada@example.com", authMethod: "claude.ai" };

    expect(engineAccountOf(JSON.stringify(status), true)).toEqual({
      signedIn: true,
      pastedToken: true,
      apiKey: false,
      email: undefined,
      plan: undefined,
    });
    expect(engineAccountOf(SIGNED_OUT, true)).toEqual({ signedIn: false });
  });

  it("is refused in the binary's words when it printed no status", () => {
    expect(() => engineAccountOf("error: unknown option '--json'\nmore", false)).toThrow(
      new EngineAccountUnreadable(
        "Claude Code gave no account status: error: unknown option '--json'",
      ),
    );
    expect(() => engineAccountOf("", false)).toThrow("Claude Code gave no account status.");
  });
});

describe("a Codex engine's account, read from the app-server's `account/read`", () => {
  it("is signed out with no account", () => {
    expect(codexEngineAccountOf(null)).toEqual({ signedIn: false });
  });

  it("tells an API key signs it in, with no email or plan", () => {
    expect(codexEngineAccountOf({ type: "apiKey" })).toEqual({
      signedIn: true,
      pastedToken: false,
      apiKey: true,
      email: undefined,
      plan: undefined,
    });
  });

  it("gives a ChatGPT login's email and plan, leaving out what it doesn't tell", () => {
    expect(
      codexEngineAccountOf({ type: "chatgpt", email: "ada@example.com", planType: "plus" }),
    ).toEqual({
      signedIn: true,
      pastedToken: false,
      apiKey: false,
      email: "ada@example.com",
      plan: "plus",
    });
    expect(codexEngineAccountOf({ type: "chatgpt", email: null })).toMatchObject({
      signedIn: true,
      email: undefined,
      plan: undefined,
    });
  });

  it("is signed in by a kind of login it doesn't know, telling nothing more", () => {
    expect(codexEngineAccountOf({ type: "amazonBedrock" })).toEqual({
      signedIn: true,
      pastedToken: false,
      apiKey: false,
      email: undefined,
      plan: undefined,
    });
  });
});
