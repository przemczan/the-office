import { basename } from "node:path";
import { describe, expect, it } from "vitest";
import { currentOperatingSystem } from "../../../../platform/os/current-operating-system.js";
import { pinnedCodexPath } from "./codex-binary.js";

describe("pinnedCodexPath", () => {
  it("finds this system's native binary in the pinned package", () => {
    const binary = pinnedCodexPath(currentOperatingSystem().codexBinary);

    expect(basename(binary)).toMatch(/^codex(\.exe)?$/);
  });

  it("refuses a processor Codex has no build for", () => {
    expect(() => pinnedCodexPath(undefined)).toThrow(/no build for this processor/);
  });

  it("refuses a platform package that isn't installed", () => {
    expect(() => pinnedCodexPath("plan9-x64/vendor/x/bin/codex")).toThrow(
      /@openai\/codex-plan9-x64 isn't installed/,
    );
  });
});
