import { describe, expect, it } from "vitest";
import { linux } from "../../../platform/os/linux.js";
import { windows } from "../../../platform/os/windows.js";
import { UNCHANGED_ENVIRONMENT } from "../domain/project-environment.js";
import { commandEnvironment } from "./command-environment.js";

const onLinux = linux({ variables: {}, homeDirectory: "/home/office" });
const onWindows = windows({ variables: {}, homeDirectory: "C:\\Users\\office" });

describe("commandEnvironment", () => {
  it("leaves out The Office's own variables and production switches", () => {
    const inherited = {
      HOME: "/home/office",
      DATABASE_URL: "postgres://office:secret@127.0.0.1/the_office",
      NODE_ENV: "production",
      npm_config_local_prefix: "/home/office/the-office",
      UNSET: undefined,
    };

    expect(commandEnvironment(inherited, UNCHANGED_ENVIRONMENT, onLinux)).toEqual({
      HOME: "/home/office",
    });
  });

  it("leaves out the credentials for publishing, which only The Office's own code uses", () => {
    const inherited = { HOME: "/home/office", GH_TOKEN: "gho_secret", GITHUB_TOKEN: "ghp_secret" };

    expect(commandEnvironment(inherited, UNCHANGED_ENVIRONMENT, onLinux)).toEqual({
      HOME: "/home/office",
    });
  });

  it("gives Secret variables as plain ones: commands and Agents' sessions run with them", () => {
    expect(
      commandEnvironment(
        { HOME: "/home/office" },
        {
          set: [{ name: "NPM_TOKEN", value: "npm_s3cret", secret: true }],
          unset: [],
          prependPath: [],
        },
        onLinux,
      ),
    ).toEqual({ HOME: "/home/office", NPM_TOKEN: "npm_s3cret" });
  });

  it("removes, then sets, then puts folders in front of PATH with a colon on Linux", () => {
    const inherited = { PATH: "/usr/bin", JAVA_HOME: "/opt/java-17", GRADLE_OPTS: "-Xmx1g" };

    const variables = commandEnvironment(
      inherited,
      {
        set: [
          { name: "JAVA_HOME", value: "/opt/java-21", secret: false },
          { name: "NODE_ENV", value: "test", secret: false },
        ],
        unset: ["GRADLE_OPTS"],
        prependPath: ["/opt/java-21/bin", "/opt/gradle/bin"],
      },
      onLinux,
    );

    expect(variables).toEqual({
      PATH: "/opt/java-21/bin:/opt/gradle/bin:/usr/bin",
      JAVA_HOME: "/opt/java-21",
      NODE_ENV: "test",
    });
  });

  it("keeps names apart by case on Linux", () => {
    const variables = commandEnvironment(
      { path: "/lowercase" },
      { set: [], unset: [], prependPath: ["/opt/bin"] },
      onLinux,
    );

    expect(variables).toEqual({ path: "/lowercase", PATH: "/opt/bin" });
  });

  it("changes the inherited variable whatever its case on Windows, with a semicolon in Path", () => {
    const inherited = {
      Path: "C:\\Windows\\System32",
      JAVA_HOME: "C:\\java-17",
      GRADLE_OPTS: "-Xmx1g",
      Node_Env: "production",
    };

    const variables = commandEnvironment(
      inherited,
      {
        set: [{ name: "java_home", value: "C:\\java-21", secret: false }],
        unset: ["gradle_opts"],
        prependPath: ["C:\\java-21\\bin"],
      },
      onWindows,
    );

    expect(variables).toEqual({
      Path: "C:\\java-21\\bin;C:\\Windows\\System32",
      JAVA_HOME: "C:\\java-21",
    });
  });

  it("starts PATH when nothing was inherited", () => {
    expect(
      commandEnvironment({}, { set: [], unset: [], prependPath: ["/opt/bin"] }, onLinux),
    ).toEqual({ PATH: "/opt/bin" });
  });
});
