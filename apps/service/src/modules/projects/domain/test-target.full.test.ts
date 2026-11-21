import { describe, expect, it } from "vitest";
import {
  editedTestTargets,
  setByAfter,
  shownTestTargets,
  testTargetProblems,
  type TestTarget,
  type TestTargetSetter,
} from "./test-target.js";

const ANN: TestTargetSetter = { by: "user", user: { userId: "user-ann", name: "Ann" } };
const BEN: TestTargetSetter = { by: "user", user: { userId: "user-ben", name: "Ben" } };

const WEB: TestTarget = {
  key: "web",
  name: "Web app",
  kind: "hosted",
  entryPoint: { kind: "package-script", manifest: "package.json", script: "start", arguments: [] },
  port: 5173,
  portVariable: "PORT",
  variables: [],
  secretVariables: [{ name: "API_KEY", value: "api-s3cret" }],
  commandsBefore: [],
  memoryMegabytes: null,
  setBy: { name: ANN, kind: ANN, entryPoint: ANN, port: ANN, variables: ANN, secretVariables: ANN },
};

const COMMAND_KEYS = ["build", "lint", "test"];

function problemsOf(portVariable: string): string[] {
  const target: TestTarget = { ...WEB, kind: "hosted", port: 5173, portVariable };
  return testTargetProblems([target], COMMAND_KEYS);
}

describe("editedTestTargets", () => {
  it("keeps a Secret variable's value sent without one, and leaves a new one without", () => {
    const [edited] = editedTestTargets(
      [WEB],
      [
        {
          ...WEB,
          name: " Web ",
          portVariable: " PORT ",
          commandsBefore: [" build ", " "],
          secretVariables: [{ name: " API_KEY " }, { name: "MAPS_KEY", value: "" }],
        },
      ],
    );

    expect(edited).toEqual({
      ...WEB,
      name: "Web",
      commandsBefore: ["build"],
      secretVariables: [
        { name: "API_KEY", value: "api-s3cret" },
        { name: "MAPS_KEY", value: null },
      ],
    });
    expect(edited && shownTestTargets([edited])[0]?.secretVariables).toEqual([
      { name: "API_KEY", valueSet: true },
      { name: "MAPS_KEY", valueSet: false },
    ]);
  });
});

describe("setByAfter", () => {
  it("stamps only the fields that changed, a Secret variable's typed value among them", () => {
    const after = {
      ...WEB,
      port: 3000,
      secretVariables: [{ name: "API_KEY", value: "new-s3cret" }],
    };

    expect(setByAfter(WEB, after, BEN)).toEqual({
      ...WEB.setBy,
      port: BEN,
      secretVariables: BEN,
    });
  });

  it("stamps the commands before the entry point, the port variable and the memory when they change", () => {
    const after = {
      ...WEB,
      commandsBefore: ["build"],
      portVariable: "WEB_PORT",
      memoryMegabytes: 1024,
    };

    expect(setByAfter(WEB, after, BEN)).toEqual({
      ...WEB.setBy,
      commandsBefore: BEN,
      portVariable: BEN,
      memoryMegabytes: BEN,
    });
  });

  it("forgets the fields of the kind left, and stamps every field of a target added", () => {
    const { port: _port, portVariable: _portVariable, ...rest } = WEB;
    const built = { ...rest, kind: "build-to-install" as const, outputPatterns: ["out/*.apk"] };

    expect(setByAfter({ ...WEB, setBy: { ...WEB.setBy, portVariable: ANN } }, built, BEN)).toEqual({
      name: ANN,
      kind: BEN,
      entryPoint: ANN,
      outputPatterns: BEN,
      variables: ANN,
      secretVariables: ANN,
    });
    expect(Object.keys(setByAfter(undefined, WEB, BEN))).toEqual([
      "name",
      "kind",
      "entryPoint",
      "port",
      "variables",
      "secretVariables",
      "commandsBefore",
      "portVariable",
      "memoryMegabytes",
    ]);
  });
});

describe("testTargetProblems", () => {
  it("takes the Project's commands before the entry point, a port variable and memory on its steps", () => {
    expect(
      testTargetProblems(
        [
          {
            ...WEB,
            commandsBefore: ["build", "test"],
            portVariable: "_PORT2",
            memoryMegabytes: 65_536,
          },
        ],
        COMMAND_KEYS,
      ),
    ).toEqual([]);
  });

  it("refuses a command the Project hasn't, once however often named", () => {
    expect(
      testTargetProblems([{ ...WEB, commandsBefore: ["seed", "build", "seed"] }], COMMAND_KEYS),
    ).toEqual([
      `Test target "web": The command seed in its commands before the entry point isn't one of the Project's commands.`,
    ]);
  });

  it("refuses a port variable that isn't a name, is OFFICE_TEST_INSTANCE or is one of its own variables", () => {
    expect(problemsOf("WEB-PORT")).toEqual([
      `Test target "web": Its port variable must be a variable's name: letters, digits and _, not starting with a digit, such as PORT.`,
    ]);
    expect(problemsOf("")).toHaveLength(1);
    expect(problemsOf("OFFICE_TEST_INSTANCE")).toEqual([
      `Test target "web": Its port variable can't be OFFICE_TEST_INSTANCE: The Office sets it in every test instance.`,
    ]);
    expect(problemsOf("API_KEY")).toEqual([
      `Test target "web": Its port variable API_KEY is one of its own variables too: give the port its own name.`,
    ]);
  });

  it("refuses memory outside 0.5 GB to 64 GB or off its 0.5 GB steps", () => {
    const words = `Test target "web": Its memory per service is between 0.5 GB and 64 GB, in steps of 0.5 GB.`;
    for (const memoryMegabytes of [0, 256, 700, 65_537, 66_048, 1024.5]) {
      expect(testTargetProblems([{ ...WEB, memoryMegabytes }], COMMAND_KEYS)).toEqual([words]);
    }
  });
});
