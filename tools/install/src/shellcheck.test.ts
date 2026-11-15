import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { it } from "node:test";
import { INSTALL_SCRIPT } from "./install-script.fixtures.ts";

const shellcheckFound = spawnSync("shellcheck", ["--version"]).status === 0;

it(
  "install.sh passes shellcheck",
  {
    skip: shellcheckFound
      ? false
      : "shellcheck isn't on PATH; the run environment (.devcontainer/Dockerfile) has it",
  },
  () => {
    const result = spawnSync("shellcheck", ["-x", INSTALL_SCRIPT], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  },
);
