import assert from "node:assert/strict";
import { test } from "node:test";
import { webLayerViolation, webPlaceOf } from "./web-layers.ts";

function violation(importerPath: string, targetPath: string): string | undefined {
  return webLayerViolation(webPlaceOf(importerPath), webPlaceOf(targetPath));
}

test("a surface uses the shell, the API and its own files", () => {
  assert.equal(violation("src/surfaces/now/now-page.tsx", "src/shell/desk.tsx"), undefined);
  assert.equal(violation("src/surfaces/now/now-page.tsx", "src/api/api-client.ts"), undefined);
  assert.equal(
    violation("src/surfaces/now/now-page.tsx", "src/surfaces/now/needs-you.tsx"),
    undefined,
  );
});

test("a surface never imports another", () => {
  assert.match(
    violation("src/surfaces/now/now-page.tsx", "src/surfaces/work/board.tsx") ?? "",
    /The now surface imports the work surface/,
  );
});

test("the shell imports the API but no surface", () => {
  assert.equal(
    violation("src/shell/status-strip.tsx", "src/api/event-stream-provider.tsx"),
    undefined,
  );
  assert.match(
    violation("src/shell/shell.tsx", "src/surfaces/now/now-page.tsx") ?? "",
    /The shell frames the surfaces and never imports one/,
  );
});

test("the API imports neither the shell nor a surface", () => {
  assert.match(
    violation("src/api/event-stream.ts", "src/shell/desk.tsx") ?? "",
    /src\/api\/ is the web's side/,
  );
  assert.match(
    violation("src/api/event-stream.ts", "src/surfaces/now/now-page.tsx") ?? "",
    /src\/api\/ is the web's side/,
  );
});

test("only the composition files import the composition files", () => {
  assert.equal(violation("src/main.tsx", "src/app.tsx"), undefined);
  assert.equal(violation("src/router.tsx", "src/surfaces/now/now-page.tsx"), undefined);
  assert.match(
    violation("src/shell/rail.tsx", "src/router.tsx") ?? "",
    /src\/router composes the app/,
  );
});

test("src/ holds no other folder", () => {
  assert.match(
    violation("src/shell/rail.tsx", "src/utils/format.ts") ?? "",
    /src\/utils\/ is none of the web's areas/,
  );
});

test("files outside src/ are not the layout's to guard", () => {
  assert.equal(violation("e2e/shell.e2e.ts", "src/router.tsx"), undefined);
  assert.equal(violation("vitest.config.ts", "vite.config.ts"), undefined);
});
