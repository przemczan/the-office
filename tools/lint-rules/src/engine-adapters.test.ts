import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { engineAdapterViolation } from "./engine-adapters.ts";

const adapters = "src/modules/engine/adapters";

function violation(importer: string, target: string): string | undefined {
  const importerPath = `${adapters}/${importer}`;
  return engineAdapterViolation(
    importerPath,
    /\.(test|fixtures)\.ts$/.test(importerPath),
    `${adapters}/${target}`,
  );
}

describe("engine type adapters", () => {
  test("import their own folder, shared/ and the engine's other adapters", () => {
    assert.equal(violation("codex/codex-engine.ts", "codex/codex-rpc.js"), undefined);
    assert.equal(violation("codex/codex-engine.ts", "shared/engine-read.js"), undefined);
    assert.equal(violation("codex/codex-engine.ts", "office-rules/tool-decision.js"), undefined);
  });

  test("never another engine type's", () => {
    assert.match(
      violation("codex/codex-engine.ts", "claude-code/engine-credentials.js") ?? "",
      /engine\/adapters\/codex\/ imports engine\/adapters\/claude-code\//,
    );
    assert.match(
      violation("gemini-cli/a.ts", "openai-compatible-api/user-content.js") ?? "",
      /Move what both need to shared\//,
    );
    assert.match(violation("scripted/a.ts", "claude-code/a.js") ?? "", /imports only its own/);
  });

  test("the Claude Code family shares claude-code/, one way", () => {
    assert.equal(violation("agent-sdk/a.ts", "claude-code/sdk-events.js"), undefined);
    assert.equal(violation("claude-code-p/a.ts", "claude-code/sdk-events.js"), undefined);
    assert.match(violation("claude-code/a.ts", "agent-sdk/a.js") ?? "", /imports only its own/);
    assert.match(violation("agent-sdk/a.ts", "claude-code-p/a.js") ?? "", /imports only its own/);
  });

  test("shared/ imports no engine type", () => {
    assert.match(violation("shared/a.ts", "claude-code/a.js") ?? "", /shared\/ is engine-neutral/);
  });

  test("tests and fixtures may use other engine types' fakes", () => {
    assert.equal(violation("agent-sdk/a.test.ts", "scripted/recording-engine.js"), undefined);
    assert.equal(violation("codex/a.fixtures.ts", "claude-code-p/fake.fixtures.js"), undefined);
  });

  test("files outside the engine adapters are not this rule's", () => {
    assert.equal(
      engineAdapterViolation("src/modules/work/application/a.ts", false, `${adapters}/codex/a.js`),
      undefined,
    );
  });
});
