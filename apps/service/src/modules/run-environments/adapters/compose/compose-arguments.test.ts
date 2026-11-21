import { describe, expect, it } from "vitest";
import { NO_MASK } from "../scripted/scripted-container-runtime.js";
import { attachArguments, buildArguments, execArguments } from "./compose-command-line.js";

const PROJECT = {
  name: "office-shop-task-1",
  files: ["/data/compose.yaml"],
  projectDirectory: "/data",
  services: ["app"],
};

describe("execArguments", () => {
  it("names each variable alone, so no value is in the command line", () => {
    const argv = execArguments(PROJECT, {
      service: "app",
      script: "cd /w || exit 125\nnpm test",
      variables: { OFFICE_VARIABLE_0: "npm_s3cret", OFFICE_VARIABLE_1: "1" },
      mask: NO_MASK,
      timeoutMs: 1000,
    });

    expect(argv).toEqual([
      "compose",
      "--project-name",
      "office-shop-task-1",
      "--project-directory",
      "/data",
      "--file",
      "/data/compose.yaml",
      "exec",
      "--no-TTY",
      "--env",
      "OFFICE_VARIABLE_0",
      "--env",
      "OFFICE_VARIABLE_1",
      "app",
      "/bin/sh",
      "-c",
      "cd /w || exit 125\nnpm test",
    ]);
    expect(argv.join(" ")).not.toContain("npm_s3cret");
  });
});

describe("attachArguments", () => {
  it("keeps the program's input open with no TTY, and runs it as it is, by no shell", () => {
    const argv = attachArguments(PROJECT, {
      service: "app",
      user: "node",
      arguments: [
        "/office-device-helper/office-device-helper-x86_64",
        "relay",
        "--listen",
        "127.0.0.1:0",
      ],
      errorFile: "/data/attached.log",
    });

    expect(argv).toEqual([
      "compose",
      "--project-name",
      "office-shop-task-1",
      "--project-directory",
      "/data",
      "--file",
      "/data/compose.yaml",
      "exec",
      "--interactive",
      "--no-TTY",
      "--user",
      "node",
      "app",
      "/office-device-helper/office-device-helper-x86_64",
      "relay",
      "--listen",
      "127.0.0.1:0",
    ]);
  });
});

describe("buildArguments", () => {
  it("gives each secret from the CLI's environment by its id, its value in no argument", () => {
    const argv = buildArguments({
      image: "the-office/shop:abc",
      context: "/builds/abc",
      dockerfile: "Dockerfile",
      args: {},
      secrets: { OFFICE_VARIABLE_0: "npm_s3cret" },
      labels: {},
    });

    expect(argv).toContain("--secret");
    expect(argv[argv.indexOf("--secret") + 1]).toBe("id=OFFICE_VARIABLE_0,env=OFFICE_VARIABLE_0");
    expect(argv.join(" ")).not.toContain("npm_s3cret");
  });
});
