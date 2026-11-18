import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import {
  apiKeyFileFrom,
  holdsPartOf,
  printFileCommand,
  REDACTED,
  redactKey,
  redactKeyInPlace,
  variableNames,
} from "./api-key.ts";

const KEY = "sk-ant-api03-Abcdefgh1234ijklMNOP5678qrst-uvwx";

test("the helper prints the key file with sh's single quotes on Linux", () => {
  assert.equal(
    printFileCommand("/data/engines/claude-code/.anthropic-api-key", "linux", "/usr/bin/node"),
    `'/usr/bin/node' '-e' 'process.stdout.write(fs.readFileSync(process.argv[1]))' '/data/engines/claude-code/.anthropic-api-key'`,
  );
});

test("the helper quotes a single quote in a path for sh", () => {
  assert.ok(
    printFileCommand("/data/it's/.anthropic-api-key", "linux", "/node").endsWith(
      `'/data/it'\\''s/.anthropic-api-key'`,
    ),
  );
});

test("the helper double-quotes each word on Windows", () => {
  assert.equal(
    printFileCommand("C:\\data\\.anthropic-api-key", "win32", "C:\\node\\node.exe"),
    `"C:\\node\\node.exe" "-e" "process.stdout.write(fs.readFileSync(process.argv[1]))" "C:\\data\\.anthropic-api-key"`,
  );
});

test("without ENGINE_CHECK_API_KEY_FILE the check is skipped, saying how to run it", () => {
  for (const environment of [{}, { ENGINE_CHECK_API_KEY_FILE: "  " }]) {
    const choice = apiKeyFileFrom(environment, "/work");
    assert.ok("skipped" in choice);
    assert.match(choice.skipped, /ENGINE_CHECK_API_KEY_FILE/);
  }
});

test("a relative key file is taken from where npm was run", () => {
  assert.deepEqual(
    apiKeyFileFrom({ ENGINE_CHECK_API_KEY_FILE: "key.txt", INIT_CWD: "/home/me" }, "/work"),
    { file: resolve("/home/me", "key.txt") },
  );
  assert.deepEqual(apiKeyFileFrom({ ENGINE_CHECK_API_KEY_FILE: "key.txt" }, "/work"), {
    file: resolve("/work", "key.txt"),
  });
  assert.deepEqual(apiKeyFileFrom({ ENGINE_CHECK_API_KEY_FILE: "/keys/key.txt" }, "/work"), {
    file: "/keys/key.txt",
  });
});

test("a part of the key past its shared prefix shows, the prefix alone does not", () => {
  assert.equal(holdsPartOf(`X=${KEY}`, KEY), true);
  assert.equal(holdsPartOf("HELPER_OUTPUT=1234ijklMN", KEY), true);
  assert.equal(holdsPartOf("PREFIX=sk-ant-api03-", KEY), false);
  assert.equal(holdsPartOf("PATH=/usr/bin\nHOME=/root", KEY), false);
});

test("redaction replaces every string holding part of the key, names included", () => {
  const redacted = redactKey(
    { a: [`env\nX=${KEY}`, "clean"], [`k-${KEY.slice(20, 30)}`]: 1, n: 2, b: true },
    KEY,
  );
  assert.deepEqual(redacted, { a: [REDACTED, "clean"], [REDACTED]: 1, n: 2, b: true });
  assert.equal(JSON.stringify(redacted).includes(KEY.slice(13, 21)), false);
});

test("redaction in place replaces the items of a session's records", () => {
  const messages = [{ text: KEY }, { text: "OK" }];
  redactKeyInPlace(messages, KEY);
  assert.deepEqual(messages, [{ text: REDACTED }, { text: "OK" }]);
});

test("the names of the engine's variables env printed, not their values", () => {
  assert.deepEqual(
    variableNames(
      "PATH=/bin\nCLAUDECODE=1\nANTHROPIC_API_KEY=x\nclaude_lower=y\nCLAUDECODE=1\n  CLAUDE_X=no\nnot a line",
      ["ANTHROPIC", "CLAUDE"],
    ),
    ["ANTHROPIC_API_KEY", "CLAUDECODE", "claude_lower"],
  );
});
