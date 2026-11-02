import { describe, expect, it } from "vitest";
import { engineAccountOf, EngineAccountUnreadable } from "./engine-account.js";

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
    expect(engineAccountOf(`${SIGNED_OUT}\n`)).toEqual({ signedIn: false });
  });

  it("gives the email and the plan when signed in", () => {
    const status = { loggedIn: true, email: "ada@example.com", subscriptionType: "max" };

    expect(engineAccountOf(JSON.stringify(status))).toEqual({
      signedIn: true,
      email: "ada@example.com",
      plan: "max",
    });
  });

  it("leaves out what the binary doesn't tell as text", () => {
    const status = { loggedIn: true, email: "", subscriptionType: null, authMethod: "claude.ai" };

    expect(engineAccountOf(JSON.stringify(status))).toEqual({
      signedIn: true,
      email: undefined,
      plan: undefined,
    });
  });

  it("is refused in the binary's words when it printed no status", () => {
    expect(() => engineAccountOf("error: unknown option '--json'\nmore")).toThrow(
      new EngineAccountUnreadable(
        "Claude Code gave no account status: error: unknown option '--json'",
      ),
    );
    expect(() => engineAccountOf("")).toThrow("Claude Code gave no account status.");
  });
});
