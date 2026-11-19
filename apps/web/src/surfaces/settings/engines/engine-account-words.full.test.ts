import { describe, expect, it } from "vitest";
import {
  codexAccountLine,
  copilotCliAccountLine,
  engineAccountLine,
} from "./engine-account-words.ts";

const SIGNED_OUT = { signedIn: false, pastedToken: false, apiKey: false, email: null, plan: null };

describe("a Claude Code engine's account line", () => {
  it("says it is signed out", () => {
    expect(engineAccountLine(SIGNED_OUT)).toBe("Signed out");
  });

  it("gives the email and plan of a Sign in", () => {
    expect(
      engineAccountLine({ ...SIGNED_OUT, signedIn: true, email: "ada@example.com", plan: "max" }),
    ).toBe("Signed in as ada@example.com · Claude Max");
  });

  it("gives what `claude auth status` told, and no more", () => {
    expect(engineAccountLine({ ...SIGNED_OUT, signedIn: true, email: "ada@example.com" })).toBe(
      "Signed in as ada@example.com",
    );
    expect(engineAccountLine({ ...SIGNED_OUT, signedIn: true, plan: "pro" })).toBe(
      "Signed in · Claude Pro",
    );
    expect(engineAccountLine({ ...SIGNED_OUT, signedIn: true })).toBe("Signed in");
  });

  it("says a pasted token signs it in, with no email or plan", () => {
    expect(engineAccountLine({ ...SIGNED_OUT, signedIn: true, pastedToken: true })).toBe(
      "A pasted token signs it in",
    );
  });

  it("says an API key signs it in, with no email or plan", () => {
    expect(engineAccountLine({ ...SIGNED_OUT, signedIn: true, apiKey: true })).toBe(
      "An API key signs it in",
    );
  });
});

describe("a Codex engine's account line", () => {
  it("says it is signed out", () => {
    expect(codexAccountLine(SIGNED_OUT)).toBe("Signed out");
  });

  it("gives the email and plan of a ChatGPT sign-in, as told", () => {
    expect(
      codexAccountLine({ ...SIGNED_OUT, signedIn: true, email: "ada@example.com", plan: "plus" }),
    ).toBe("Signed in with ChatGPT as ada@example.com · ChatGPT Plus");
    expect(codexAccountLine({ ...SIGNED_OUT, signedIn: true, email: "ada@example.com" })).toBe(
      "Signed in with ChatGPT as ada@example.com",
    );
    expect(codexAccountLine({ ...SIGNED_OUT, signedIn: true })).toBe("Signed in with ChatGPT");
  });

  it("says an API key signs it in, with no email or plan", () => {
    expect(codexAccountLine({ ...SIGNED_OUT, signedIn: true, apiKey: true })).toBe(
      "Signed in with an API key",
    );
  });
});

describe("a Copilot CLI engine's account line", () => {
  it("says it is signed out", () => {
    expect(copilotCliAccountLine(SIGNED_OUT)).toBe("Signed out");
  });

  it("gives the GitHub login of a Sign in, when told", () => {
    expect(copilotCliAccountLine({ ...SIGNED_OUT, signedIn: true, email: "octocat" })).toBe(
      "Signed in as octocat",
    );
    expect(copilotCliAccountLine({ ...SIGNED_OUT, signedIn: true })).toBe("Signed in");
  });

  it("says a pasted token signed it in, with the login when told", () => {
    expect(copilotCliAccountLine({ ...SIGNED_OUT, signedIn: true, pastedToken: true })).toBe(
      "Signed in by a pasted token",
    );
    expect(
      copilotCliAccountLine({ ...SIGNED_OUT, signedIn: true, pastedToken: true, email: "octocat" }),
    ).toBe("Signed in as octocat by a pasted token");
  });
});
