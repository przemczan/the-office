import { describe, expect, it } from "vitest";
import {
  environmentProblems,
  sameEnvironment,
  trimmedEnvironment,
  UNCHANGED_ENVIRONMENT,
} from "./project-environment.js";

describe("trimmedEnvironment", () => {
  it("trims names and folders, keeps values as given, and leaves out blank rows", () => {
    expect(
      trimmedEnvironment({
        set: [
          { name: " JAVA_HOME ", value: " /opt/java-21 " },
          { name: " ", value: "" },
        ],
        unset: [" NODE_OPTIONS", ""],
        prependPath: [" /opt/gradle/bin ", "  "],
      }),
    ).toEqual({
      set: [{ name: "JAVA_HOME", value: " /opt/java-21 " }],
      unset: ["NODE_OPTIONS"],
      prependPath: ["/opt/gradle/bin"],
    });
  });
});

describe("environmentProblems", () => {
  it("takes named variables", () => {
    expect(
      environmentProblems({
        set: [{ name: "JAVA_HOME", value: "/opt/java-21" }],
        unset: ["NODE_OPTIONS"],
        prependPath: ["/opt/gradle/bin"],
      }),
    ).toEqual([]);
  });

  it("lists every problem at once", () => {
    expect(
      environmentProblems({
        set: [
          { name: "", value: "orphan" },
          { name: "A=B", value: "" },
          { name: "CI", value: "1" },
          { name: "CI", value: "true" },
        ],
        unset: ["X=Y"],
        prependPath: [],
      }),
    ).toEqual([
      "Give each variable a name.",
      "A variable's name can't have \"=\" in it: A=B.",
      "CI is set more than once.",
      "A variable's name can't have \"=\" in it: X=Y.",
    ]);
  });
});

describe("sameEnvironment", () => {
  const environment = {
    set: [{ name: "CI", value: "1" }],
    unset: ["NODE_OPTIONS"],
    prependPath: ["/opt/bin"],
  };

  it("compares each part in order", () => {
    expect(sameEnvironment(environment, { ...environment })).toBe(true);
    expect(
      sameEnvironment(environment, { ...environment, set: [{ name: "CI", value: "2" }] }),
    ).toBe(false);
    expect(sameEnvironment(environment, UNCHANGED_ENVIRONMENT)).toBe(false);
  });
});
