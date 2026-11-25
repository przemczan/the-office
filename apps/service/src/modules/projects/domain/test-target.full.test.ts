import { describe, expect, it } from "vitest";
import {
  editedTestTargets,
  fieldsOfKind,
  installTargetProblems,
  sameTestTargets,
  setByAfter,
  shownTestTargets,
  testTargetProblems,
  type TestTarget,
  type TestTargetSetter,
} from "./test-target.js";

const ANN: TestTargetSetter = { by: "user", user: { userId: "user-ann", name: "Ann" } };
const BEN: TestTargetSetter = { by: "user", user: { userId: "user-ben", name: "Ben" } };

const WEB: Extract<TestTarget, { kind: "hosted" }> = {
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
    const [shown] = edited ? shownTestTargets([edited]) : [];
    expect(shown && "secretVariables" in shown ? shown.secretVariables : undefined).toEqual([
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

const BUILD: TestTarget = {
  ...WEB,
  key: "apk",
  name: "APK",
  kind: "build-to-install",
  outputPatterns: ["app/build/outputs/apk/debug/*.apk"],
  setBy: {},
};

const INSTALL: TestTarget = {
  key: "phone",
  name: "Install on the phone",
  kind: "install-on-a-device",
  buildTargetKey: "apk",
  projectDeviceId: "device-1",
  setBy: { name: ANN },
};

const PHONES = [
  { id: "device-1", androidPhone: true },
  { id: "device-2", androidPhone: false },
];

describe("Install on a device", () => {
  it("has only its name, kind, Build to install target and device as fields", () => {
    expect(fieldsOfKind("install-on-a-device")).toEqual([
      "name",
      "kind",
      "buildTargetKey",
      "projectDeviceId",
    ]);
    expect(fieldsOfKind("hosted")).not.toContain("buildTargetKey");
    expect(Object.keys(setByAfter(undefined, INSTALL, BEN))).toEqual([
      "name",
      "kind",
      "buildTargetKey",
      "projectDeviceId",
    ]);
  });

  it("is saved with a Build to install target among the targets and no entry point", () => {
    expect(testTargetProblems([BUILD, INSTALL], COMMAND_KEYS)).toEqual([]);
    expect(
      editedTestTargets(
        [],
        [{ ...INSTALL, buildTargetKey: " apk ", projectDeviceId: " device-1 " }],
      ),
    ).toEqual([{ ...INSTALL, setBy: {} }]);
    expect(shownTestTargets([INSTALL])).toEqual([INSTALL]);
  });

  it("tells a changed device or Build to install target from the same", () => {
    expect(sameTestTargets([BUILD, INSTALL], [BUILD, { ...INSTALL }])).toBe(true);
    expect(sameTestTargets([INSTALL], [{ ...INSTALL, projectDeviceId: "device-2" }])).toBe(false);
    expect(sameTestTargets([INSTALL], [{ ...INSTALL, buildTargetKey: "web" }])).toBe(false);
    expect(sameTestTargets([WEB], [INSTALL])).toBe(false);
  });

  it("is refused naming a Build to install target the Project lacks, or one of another kind", () => {
    expect(installTargetProblems([INSTALL], "Shop", PHONES, ["phone"])).toEqual([
      `Test target "phone": apk isn't one of «Shop»'s Build to install targets.`,
    ]);
    expect(
      installTargetProblems([{ ...WEB, key: "apk" }, INSTALL], "Shop", PHONES, ["phone"]),
    ).toHaveLength(1);
    expect(installTargetProblems([BUILD, INSTALL], "Shop", PHONES, ["phone"])).toEqual([]);
  });

  it("is refused naming a device that is missing or no Android phone, when it is to be checked", () => {
    expect(
      installTargetProblems([BUILD, { ...INSTALL, projectDeviceId: "device-2" }], "Shop", PHONES, [
        "phone",
      ]),
    ).toEqual([`Test target "phone": device-2 isn't an Android phone among «Shop»'s devices.`]);
    expect(
      installTargetProblems([BUILD, { ...INSTALL, projectDeviceId: "gone" }], "Shop", PHONES, [
        "phone",
      ]),
    ).toEqual([`Test target "phone": gone isn't an Android phone among «Shop»'s devices.`]);
    expect(
      installTargetProblems([BUILD, { ...INSTALL, projectDeviceId: "gone" }], "Shop", PHONES, []),
    ).toEqual([]);
  });

  it("asks for both settings, and Deployed elsewhere stays unbuilt", () => {
    expect(
      testTargetProblems([{ ...INSTALL, buildTargetKey: "", projectDeviceId: "" }], COMMAND_KEYS),
    ).toEqual([
      `Test target "phone": Give the Build to install target it installs.`,
      `Test target "phone": Give the device it installs on.`,
    ]);
    expect(
      testTargetProblems([{ ...WEB, key: "remote", kind: "deployed-elsewhere" }], COMMAND_KEYS),
    ).toEqual([`Test target "remote": Deployed elsewhere isn't built yet.`]);
  });
});
