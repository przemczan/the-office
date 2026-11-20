import { describe, expect, it } from "vitest";
import { GEMINI_CLI_CAPABILITIES } from "./gemini-cli-capabilities.js";
import { UnavailableGeminiCliEngine } from "./unavailable-gemini-cli-engine.js";

const WORDS = "Sessions on a Gemini CLI engine can't run yet.";

describe("UnavailableGeminiCliEngine", () => {
  it("refuses to start a session in words", async () => {
    const engine = new UnavailableGeminiCliEngine();

    await expect(engine.start({ id: "s-1" } as Parameters<typeof engine.start>[0])).rejects.toThrow(
      WORDS,
    );
  });

  it("refuses to resume a session in words", async () => {
    const engine = new UnavailableGeminiCliEngine();

    await expect(engine.resume("s-1", {} as Parameters<typeof engine.resume>[1])).rejects.toThrow(
      WORDS,
    );
  });

  it("declares no language servers, no barge-in, no usage windows and no carried session", () => {
    const { capabilities } = new UnavailableGeminiCliEngine();

    expect(capabilities).toBe(GEMINI_CLI_CAPABILITIES);
    expect(capabilities).toMatchObject({
      languageServers: false,
      bargeIn: false,
      usageWindows: false,
      carrySession: false,
    });
  });

  it("reads no usage windows", async () => {
    await expect(new UnavailableGeminiCliEngine().readUsageWindows()).resolves.toBeUndefined();
  });
});
