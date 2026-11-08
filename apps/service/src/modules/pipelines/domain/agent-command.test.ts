import { describe, expect, it } from "vitest";
import { agentCommandOf } from "./agent-command.js";

describe("agentCommandOf", () => {
  it("takes one of the Project's commands by its key", () => {
    expect(agentCommandOf("test", undefined)).toEqual({ key: "test" });
  });

  it("takes a command line the Agent wrote, without the spaces around it", () => {
    expect(agentCommandOf(undefined, "  npx vitest run one.test.ts \n")).toEqual({
      commandLine: "npx vitest run one.test.ts",
    });
  });

  it("refuses both at once, in words that say why", () => {
    expect(agentCommandOf("test", "npm test")).toBe(
      "Give either command or commandLine, not both.",
    );
  });

  it("refuses neither, or a blank command line, naming the keys", () => {
    const refusal =
      "Give the command to run: command, one of install, build, lint, test, or commandLine.";
    expect(agentCommandOf(undefined, undefined)).toBe(refusal);
    expect(agentCommandOf(undefined, "   ")).toBe(refusal);
  });
});
