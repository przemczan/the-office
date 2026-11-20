import assert from "node:assert/strict";
import { test } from "node:test";
import { codexAppServerArguments, codexEnvironment, tomlValue } from "./arguments.ts";

test("each override becomes a -c key=value pair after app-server", () => {
  assert.deepEqual(
    codexAppServerArguments({
      "sandbox_workspace_write.exclude_slash_tmp": true,
      web_search: "disabled",
    }),
    [
      "app-server",
      "-c",
      "sandbox_workspace_write.exclude_slash_tmp=true",
      "-c",
      'web_search="disabled"',
    ],
  );
});

test("values are written as TOML: quoted strings, bare numbers and booleans, arrays", () => {
  assert.equal(tomlValue('say "hi"'), '"say \\"hi\\""');
  assert.equal(tomlValue(30), "30");
  assert.equal(tomlValue(false), "false");
  assert.equal(tomlValue(["a", 1, true]), '["a", 1, true]');
});

test("the environment drops OpenAI and Codex variables, then sets CODEX_HOME and the extra ones", () => {
  assert.deepEqual(
    codexEnvironment(
      "/engines/codex-1",
      { OFFICE_TOOL_TOKEN: "token" },
      { PATH: "/bin", OPENAI_API_KEY: "key", CODEX_HOME: "/elsewhere", codex_sandbox: "seatbelt" },
    ),
    { PATH: "/bin", CODEX_HOME: "/engines/codex-1", OFFICE_TOOL_TOKEN: "token" },
  );
});
