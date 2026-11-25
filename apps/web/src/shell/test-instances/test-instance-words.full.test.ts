import type { TestInstance, TestInstanceState } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import {
  builtForWords,
  installsWords,
  instanceLine,
  isActive,
  isWorking,
  logLinesOf,
  needsRunEnvironment,
  onDeviceWords,
  reusingBuildWords,
  TEST_INSTANCE_STATE_WORDS,
} from "./test-instance-words.ts";

const LAUNCHED_AT = "2026-11-20T14:02:00.000Z";

function anInstance(state: TestInstanceState, commit: string | null = null): TestInstance {
  return {
    id: `${state}-${commit ?? "none"}`,
    initiativeId: "7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f",
    branch: "initiative/checkout",
    projectId: "website",
    targetKey: "office",
    targetName: "Office",
    kind: "hosted",
    state,
    commit,
    port: null,
    failedReason: null,
    launchedBy: { kind: "user", user: null },
    launchedAt: LAUNCHED_AT,
    runningAt: null,
    endedAt: null,
    files: [],
    filesRemoved: false,
    runAs: null,
    device: null,
    buildInstanceId: null,
    builtFor: null,
  };
}

describe("a row's line", () => {
  it("gives the short commit and the moment, or the moment alone before the checkout", () => {
    const now = new Date(LAUNCHED_AT);
    expect(instanceLine(anInstance("building", "a1b2c3d4e5f6"), now)).toMatch(
      /^a1b2c3d · \d\d:\d\d$/,
    );
    expect(instanceLine(anInstance("building"), now)).toMatch(/^\d\d:\d\d$/);
  });
});

describe("the log's lines", () => {
  it("marks The Office's own lines and the reason it failed", () => {
    expect(
      logLinesOf("[The Office] Fetching main.\nlistening\n[The Office] Failed: no answer.\n"),
    ).toEqual([
      { kind: "office", text: "Fetching main." },
      { kind: "output", text: "listening" },
      { kind: "failed", text: "Failed: no answer." },
    ]);
  });
});

describe("an Install on a device's words", () => {
  const PIXEL = { projectDeviceId: "d1", name: "Pixel 8", kind: "android-wireless" } as const;

  it("names its states, which are active, and Installing as working", () => {
    expect(TEST_INSTANCE_STATE_WORDS.installing).toBe("Installing");
    expect(TEST_INSTANCE_STATE_WORDS.installed).toBe("Installed");
    expect(isActive("installing")).toBe(true);
    expect(isActive("installed")).toBe(false);
    expect(isWorking("installing")).toBe(true);
    expect(isWorking("installed")).toBe(false);
    expect(needsRunEnvironment({ kind: "install-on-a-device" })).toBe(true);
  });

  it("says where it installs, what it built for and which build it reuses", () => {
    expect(onDeviceWords("Pixel 8")).toBe("on Pixel 8");
    expect(builtForWords("Install on Pixel")).toBe("Built for Install on Pixel");
    expect(reusingBuildWords("a1b2c3d4e5f6")).toBe("Reusing a1b2c3d's build");
    expect(reusingBuildWords(null)).toBe("Reusing a build");
  });

  it("says what a target installs, by the names the Project has now", () => {
    const installs = {
      buildTargetKey: "app",
      buildTargetName: "Android app",
      projectDeviceId: "d1",
      device: PIXEL,
    };
    expect(installsWords(installs)).toBe("Installs Android app on Pixel 8");
    expect(installsWords({ ...installs, buildTargetName: null, device: null })).toBe(
      "Installs app on a device that's gone",
    );
  });
});
