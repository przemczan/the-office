import { describe, expect, it } from "vitest";
import {
  editedEnvironment,
  environmentProblems,
  sameEnvironment,
  shownEnvironment,
  trimmedEnvironment,
  UNCHANGED_ENVIRONMENT,
  type ProjectEnvironment,
} from "./project-environment.js";

describe("trimmedEnvironment", () => {
  it("trims names and folders, keeps values as given, and leaves out blank rows", () => {
    expect(
      trimmedEnvironment({
        set: [
          { name: " JAVA_HOME ", value: " /opt/java-21 ", secret: false },
          { name: " ", value: "", secret: false },
        ],
        unset: [" NODE_OPTIONS", ""],
        prependPath: [" /opt/gradle/bin ", "  "],
      }),
    ).toEqual({
      set: [{ name: "JAVA_HOME", value: " /opt/java-21 ", secret: false }],
      unset: ["NODE_OPTIONS"],
      prependPath: ["/opt/gradle/bin"],
    });
  });
});

describe("environmentProblems", () => {
  it("takes named variables", () => {
    expect(
      environmentProblems({
        set: [{ name: "JAVA_HOME", value: "/opt/java-21", secret: false }],
        unset: ["NODE_OPTIONS"],
        prependPath: ["/opt/gradle/bin"],
      }),
    ).toEqual([]);
  });

  it("lists every problem at once", () => {
    expect(
      environmentProblems({
        set: [
          { name: "", value: "orphan", secret: false },
          { name: "A=B", value: "", secret: false },
          { name: "CI", value: "1", secret: false },
          { name: "CI", value: "true", secret: false },
        ],
        unset: ["X=Y"],
        prependPath: [],
      }),
    ).toEqual([
      "Give each variable a name.",
      "A variable's name takes letters, digits and _, not starting with a digit: A=B.",
      "CI is set more than once.",
      "A variable's name can't have \"=\" in it: X=Y.",
    ]);
  });

  it("sets only a name a shell can hold, and removes one as The Office's environment names it", () => {
    expect(
      environmentProblems({
        set: [
          { name: "_PRIVATE_1", value: "", secret: false },
          { name: "MY-VAR", value: "", secret: false },
          { name: "1ST", value: "", secret: false },
          { name: 'X"; touch /tmp/owned; "', value: "", secret: false },
          { name: "NPM TOKEN", value: "npm_ab", secret: true },
        ],
        unset: ["ProgramFiles(x86)"],
        prependPath: [],
      }),
    ).toEqual([
      "A variable's name takes letters, digits and _, not starting with a digit: MY-VAR.",
      "A variable's name takes letters, digits and _, not starting with a digit: 1ST.",
      'A variable\'s name takes letters, digits and _, not starting with a digit: X"; touch /tmp/owned; ".',
      "A variable's name takes letters, digits and _, not starting with a digit: NPM TOKEN.",
    ]);
  });
});

const secret = (name: string, value: string) => ({ name, value, secret: true });

describe("environmentProblems of Secret variables", () => {
  it("takes a one-line value of at least 6 characters", () => {
    expect(
      environmentProblems({ set: [secret("NPM_TOKEN", "npm_ab")], unset: [], prependPath: [] }),
    ).toEqual([]);
  });

  it("refuses a short, empty or multi-line value, and a name also used for a plain one", () => {
    expect(
      environmentProblems({
        set: [
          secret("SHORT", "12345"),
          secret("EMPTY", ""),
          secret("LINES", "first line\nsecond"),
          { name: "TOKEN", value: "plain", secret: false },
          secret("TOKEN", "a-secret-token"),
        ],
        unset: [],
        prependPath: [],
      }),
    ).toEqual([
      "The value of the Secret variable SHORT is shorter than 6 characters, so hiding it in output could hide ordinary text.",
      "Give the Secret variable EMPTY a value.",
      "The value of the Secret variable LINES has a line break: it takes one line.",
      "TOKEN is both a plain and a Secret variable: make it one or the other.",
    ]);
  });
});

describe("editedEnvironment", () => {
  const kept: ProjectEnvironment = {
    set: [
      { name: "NPM_TOKEN", value: "kept-token", secret: true },
      { name: "PLAIN", value: "kept-plain", secret: false },
    ],
    unset: [],
    prependPath: [],
  };

  it("keeps a Secret variable's value when the edit leaves it out or empty", () => {
    expect(
      editedEnvironment(
        {
          set: [
            { name: " NPM_TOKEN ", secret: true },
            { name: "NPM_TOKEN", secret: true, value: "" },
            { name: "PLAIN", secret: false, value: "" },
          ],
          unset: [],
          prependPath: [],
        },
        kept,
      ).set,
    ).toEqual([
      { name: "NPM_TOKEN", value: "kept-token", secret: true },
      { name: "NPM_TOKEN", value: "kept-token", secret: true },
      { name: "PLAIN", value: "", secret: false },
    ]);
  });

  it("takes a new value, and leaves one never kept empty", () => {
    expect(
      editedEnvironment(
        {
          set: [
            { name: "NPM_TOKEN", secret: true, value: "new-token" },
            { name: "PLAIN", secret: true },
          ],
          unset: [],
          prependPath: [],
        },
        kept,
      ).set,
    ).toEqual([
      { name: "NPM_TOKEN", value: "new-token", secret: true },
      { name: "PLAIN", value: "", secret: true },
    ]);
  });
});

describe("shownEnvironment", () => {
  it("shows a Secret variable by its name alone", () => {
    expect(
      shownEnvironment({
        set: [
          { name: "CI", value: "1", secret: false },
          { name: "NPM_TOKEN", value: "kept-token", secret: true },
        ],
        unset: ["X"],
        prependPath: ["/opt/bin"],
      }),
    ).toEqual({
      set: [
        { name: "CI", value: "1", secret: false },
        { name: "NPM_TOKEN", secret: true, valueSet: true },
      ],
      unset: ["X"],
      prependPath: ["/opt/bin"],
    });
  });
});

describe("sameEnvironment", () => {
  const environment = {
    set: [{ name: "CI", value: "1", secret: false }],
    unset: ["NODE_OPTIONS"],
    prependPath: ["/opt/bin"],
  };

  it("compares each part in order", () => {
    expect(sameEnvironment(environment, { ...environment })).toBe(true);
    expect(
      sameEnvironment(environment, {
        ...environment,
        set: [{ name: "CI", value: "2", secret: false }],
      }),
    ).toBe(false);
    expect(sameEnvironment(environment, UNCHANGED_ENVIRONMENT)).toBe(false);
    expect(
      sameEnvironment(environment, {
        ...environment,
        set: [{ name: "CI", value: "1", secret: true }],
      }),
    ).toBe(false);
  });
});
