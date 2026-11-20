import { describe, expect, it } from "vitest";
import {
  editedTestTargets,
  setByAfter,
  shownTestTargets,
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
  variables: [],
  secretVariables: [{ name: "API_KEY", value: "api-s3cret" }],
  setBy: { name: ANN, kind: ANN, entryPoint: ANN, port: ANN, variables: ANN, secretVariables: ANN },
};

describe("editedTestTargets", () => {
  it("keeps a Secret variable's value sent without one, and leaves a new one without", () => {
    const [edited] = editedTestTargets(
      [WEB],
      [
        {
          ...WEB,
          name: " Web ",
          secretVariables: [{ name: " API_KEY " }, { name: "MAPS_KEY", value: "" }],
        },
      ],
    );

    expect(edited).toEqual({
      ...WEB,
      name: "Web",
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

  it("forgets the fields of the kind left, and stamps every field of a target added", () => {
    const { port: _port, ...rest } = WEB;
    const built = { ...rest, kind: "build-to-install" as const, outputPatterns: ["out/*.apk"] };

    expect(setByAfter(WEB, built, BEN)).toEqual({
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
    ]);
  });
});
