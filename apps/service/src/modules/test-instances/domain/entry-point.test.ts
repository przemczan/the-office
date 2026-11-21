import { describe, expect, it } from "vitest";
import { DEVCONTAINER_SERVICE_BUILDS_NOTHING, workstationBuildCommandOf } from "./entry-point.js";

describe("workstationBuildCommandOf", () => {
  it("runs a repository file from the checkout's root, every word quoted", () => {
    expect(
      workstationBuildCommandOf({
        kind: "repository-file",
        path: "scripts\\build.sh",
        arguments: ["--flavour", "it's debug"],
      }),
    ).toEqual({ folder: ".", commandLine: `'./scripts/build.sh' '--flavour' 'it'\\''s debug'` });
  });

  it("runs a package script by npm run in its manifest's folder", () => {
    expect(
      workstationBuildCommandOf({
        kind: "package-script",
        manifest: "apps/mobile/package.json",
        script: "build:apk",
        arguments: ["--release"],
      }),
    ).toEqual({
      folder: "apps/mobile",
      commandLine: `'npm' 'run' 'build:apk' '--' '--release'`,
    });
  });

  it("runs a Gradle task through the repository's gradlew", () => {
    expect(
      workstationBuildCommandOf({ kind: "gradle-task", task: "assembleDebug", arguments: [] }),
    ).toEqual({ folder: ".", commandLine: `'./gradlew' 'assembleDebug'` });
  });

  it("refuses a path leading out of the checkout and a devcontainer service", () => {
    expect(
      workstationBuildCommandOf({ kind: "repository-file", path: "../x.sh", arguments: [] }),
    ).toEqual({ problem: "The entry point ../x.sh isn't a file in the repository." });
    expect(
      workstationBuildCommandOf({
        kind: "package-script",
        manifest: "/etc/package.json",
        script: "build",
        arguments: [],
      }),
    ).toEqual({ problem: "The manifest /etc/package.json isn't a file in the repository." });
    expect(workstationBuildCommandOf({ kind: "devcontainer-service", service: "app" })).toEqual({
      problem: DEVCONTAINER_SERVICE_BUILDS_NOTHING,
    });
  });
});
