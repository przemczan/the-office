import type { ProjectCommand, TestTarget, TestTargetSetter } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import { entryPointWords } from "../../shell/test-target-words.ts";
import {
  editedTestTargetOf,
  movedBy,
  NEW_TEST_TARGET_DRAFT,
  needsRunEnvironment,
  notACommandWords,
  secretsNeedingValues,
  setByWords,
  targetDetailsWords,
  targetSetByWords,
  testTargetDraftOf,
  testTargetsWith,
  runnableCommandsOf,
  unknownCommandKeys,
} from "./test-target-words.ts";

const ANN: TestTargetSetter = { by: "user", user: { userId: "ann", name: "Ann Lee" } };
const BOB: TestTargetSetter = { by: "user", user: { userId: "bob", name: "Bob Hart" } };
const NINA: TestTargetSetter = {
  by: "proposal",
  proposalId: "proposal-1",
  agent: { roleKey: "devops", name: "Nina" },
};

const WEB: TestTarget = {
  key: "web",
  name: "Web app",
  kind: "hosted",
  entryPoint: {
    kind: "package-script",
    manifest: "package.json",
    script: "start",
    arguments: ["--port", "3000"],
  },
  port: 3000,
  variables: [{ name: "MODE", value: "test" }],
  secretVariables: [
    { name: "API_TOKEN", valueSet: true },
    { name: "MAPS_KEY", valueSet: false },
  ],
  commandsBefore: ["seed"],
  portVariable: "APP_PORT",
  memoryMegabytes: null,
  setBy: { name: ANN, kind: ANN, entryPoint: ANN, port: ANN, variables: ANN },
};

const APK: TestTarget = {
  key: "android",
  name: "Android",
  kind: "build-to-install",
  entryPoint: { kind: "gradle-task", task: "assembleDebug", arguments: [] },
  outputPatterns: ["app/build/outputs/apk/debug/*.apk"],
  variables: [],
  secretVariables: [],
  commandsBefore: [],
  memoryMegabytes: 4096,
  setBy: {},
};

describe("who set a test target", () => {
  it("names the signed-in user as you, another user and an Agent by name", () => {
    expect(setByWords(ANN, "ann")).toBe("Set by you");
    expect(setByWords(ANN, "bob")).toBe("Set by Ann Lee");
    expect(setByWords(NINA, "ann")).toBe("Set by Nina");
  });

  it("marks a row by everyone who set one of its values, you first, and by nobody when unknown", () => {
    expect(targetSetByWords(WEB, "ann")).toBe("Set by you");
    expect(targetSetByWords({ ...WEB, setBy: { ...WEB.setBy, port: NINA } }, "ann")).toBe(
      "Set by you and Nina",
    );
    expect(targetSetByWords({ ...WEB, setBy: { name: NINA, port: BOB, kind: ANN } }, "ann")).toBe(
      "Set by you, Nina and Bob Hart",
    );
    expect(targetSetByWords(APK, "ann")).toBeUndefined();
  });
});

describe("a test target's warnings", () => {
  it("names each Secret variable without a value", () => {
    expect(secretsNeedingValues(WEB)).toEqual(["MAPS_KEY"]);
  });

  it("asks for Run environment On only for a Hosted target", () => {
    expect(needsRunEnvironment(WEB, "off")).toBe(true);
    expect(needsRunEnvironment(WEB, "not-decided")).toBe(true);
    expect(needsRunEnvironment(WEB, "on")).toBe(false);
    expect(needsRunEnvironment(APK, "off")).toBe(false);
  });
});

describe("entryPointWords", () => {
  it("reads each entry point in one line with its arguments", () => {
    expect(entryPointWords(WEB.entryPoint)).toBe("package.json › start --port 3000");
    expect(entryPointWords(APK.entryPoint)).toBe("./gradlew assembleDebug");
    expect(
      entryPointWords({ kind: "repository-file", path: "scripts/start.sh", arguments: [] }),
    ).toBe("scripts/start.sh");
    expect(entryPointWords({ kind: "devcontainer-service", service: "web" })).toBe(
      ".devcontainer/ › web",
    );
  });
});

describe("the test target editor's draft", () => {
  it("saves a target as it was shown, each Secret variable keeping its value", () => {
    expect(editedTestTargetOf(testTargetDraftOf(WEB))).toEqual({
      target: {
        key: "web",
        name: "Web app",
        kind: "hosted",
        entryPoint: WEB.entryPoint,
        port: 3000,
        variables: [{ name: "MODE", value: "test" }],
        secretVariables: [{ name: "API_TOKEN" }, { name: "MAPS_KEY" }],
        commandsBefore: ["seed"],
        portVariable: "APP_PORT",
        memoryMegabytes: null,
      },
    });
  });

  it("sends a typed Secret value, and a Build to install target's output patterns", () => {
    const draft = testTargetDraftOf(APK);
    const edited = editedTestTargetOf({
      ...draft,
      outputPatterns: "a/*.apk\n\nb/*.aab",
      secrets: [{ key: 0, name: " SIGNING ", keptName: undefined, typed: "s3cret-value" }],
    });
    expect(edited).toEqual({
      target: {
        key: "android",
        name: "Android",
        kind: "build-to-install",
        entryPoint: APK.entryPoint,
        outputPatterns: ["a/*.apk", "b/*.aab"],
        variables: [],
        secretVariables: [{ name: "SIGNING", value: "s3cret-value" }],
        commandsBefore: [],
        memoryMegabytes: 4096,
      },
    });
  });

  it("starts a new target with no commands before, PORT and the Office default memory", () => {
    const edited = editedTestTargetOf({
      ...NEW_TEST_TARGET_DRAFT,
      key: "web",
      name: "Web",
      script: "start",
      port: "3000",
    });
    expect(edited).toMatchObject({
      target: { commandsBefore: [], portVariable: "PORT", memoryMegabytes: null },
    });
  });

  it("sends a blank port variable as PORT", () => {
    const edited = editedTestTargetOf({ ...testTargetDraftOf(WEB), portVariable: "  " });
    expect(edited).toMatchObject({ target: { portVariable: "PORT" } });
  });

  it("refuses a variable without = and a Hosted target without a whole port", () => {
    const draft = { ...testTargetDraftOf(WEB), variables: "MODE", port: "30.5" };
    expect(editedTestTargetOf(draft)).toEqual({
      problems: [
        'Write each variable as NAME=value; "MODE" has no "=".',
        "Give the port the app listens on, a whole number.",
      ],
    });
  });
});

describe("a target's commands before and its summary", () => {
  const commands: ProjectCommand[] = [
    { key: "seed", name: "Seed", kind: "build", commandLine: "npm run seed", rerunCommandLine: "" },
  ];

  it("flags a command key the Project no longer has", () => {
    expect(unknownCommandKeys(["seed", "gone"], commands)).toEqual(["gone"]);
    expect(notACommandWords("gone")).toBe("gone isn't one of the Project's commands anymore.");
  });

  it("offers Install first when the Project has an install command", () => {
    expect(runnableCommandsOf({ installCommand: "npm ci", commands })).toEqual([
      { key: "install", name: "Install" },
      { key: "seed", name: "Seed" },
    ]);
    expect(runnableCommandsOf({ installCommand: "", commands })).toEqual([
      { key: "seed", name: "Seed" },
    ]);
  });

  it("moves a command up or down, keeping the list at either end", () => {
    expect(movedBy(["a", "b", "c"], 2, -1)).toEqual(["a", "c", "b"]);
    expect(movedBy(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
    expect(movedBy(["a", "b"], 0, -1)).toEqual(["a", "b"]);
    expect(movedBy(["a", "b"], 1, 1)).toEqual(["a", "b"]);
  });

  it("sums a row up: commands before, a Hosted target's port variable and its own memory", () => {
    expect(targetDetailsWords(WEB)).toEqual(["Commands before: seed", "APP_PORT=3000"]);
    expect(targetDetailsWords(APK)).toEqual(["Memory per service 4 GB"]);
  });
});

describe("testTargetsWith", () => {
  const keptWeb = editedTestTargetOf(testTargetDraftOf(WEB));
  const keptApk = editedTestTargetOf(testTargetDraftOf(APK));
  if (!("target" in keptWeb) || !("target" in keptApk)) throw new Error("Not a target");

  it("replaces a target by its key and adds a new one last, the others keeping their values", () => {
    const renamed = { ...keptApk.target, name: "Android debug" };

    expect(testTargetsWith([WEB, APK], { edited: renamed })).toEqual([keptWeb.target, renamed]);
    expect(testTargetsWith([WEB], { edited: renamed })).toEqual([keptWeb.target, renamed]);
  });

  it("leaves out the target removed", () => {
    expect(testTargetsWith([WEB, APK], { removedKey: "web" })).toEqual([keptApk.target]);
  });
});
