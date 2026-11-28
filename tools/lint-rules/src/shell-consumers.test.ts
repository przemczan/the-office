import assert from "node:assert/strict";
import { test } from "node:test";
import {
  relativeImportsOf,
  singleSurfaceShellFiles,
  singleSurfaceWords,
  type WebFile,
} from "./shell-consumers.ts";

function file(path: string, ...imports: string[]): WebFile {
  return { path, text: imports.map((specifier) => `import "${specifier}";`).join("\n") };
}

function flagged(files: readonly WebFile[]): string[] {
  return singleSurfaceShellFiles(files).map((found) => `${found.path} ${found.surface}`);
}

test("a shell file one surface alone imports is flagged", () => {
  const found = singleSurfaceShellFiles([
    file("src/shell/work/edit-dialog.tsx"),
    file("src/surfaces/work/ideas-page.tsx", "../../shell/work/edit-dialog.tsx"),
    file("src/surfaces/work/board.tsx", "../../shell/work/edit-dialog.tsx"),
  ]);
  assert.deepEqual(found, [
    {
      path: "src/shell/work/edit-dialog.tsx",
      surface: "work",
      importers: ["src/surfaces/work/board.tsx", "src/surfaces/work/ideas-page.tsx"],
    },
  ]);
  assert.match(singleSurfaceWords(found[0]!), /move it into src\/surfaces\/work\//);
});

test("a shell file two surfaces share stays", () => {
  assert.deepEqual(
    flagged([
      file("src/shell/desk.tsx"),
      file("src/surfaces/now/now-page.tsx", "../../shell/desk.tsx"),
      file("src/surfaces/work/board.tsx", "../../shell/desk.tsx"),
    ]),
    [],
  );
});

test("a shell file the shell's frame or the app's composition uses stays", () => {
  assert.deepEqual(
    flagged([
      file("src/shell/rail.tsx"),
      file("src/shell/root-layout.tsx", "./rail.tsx"),
      file("src/router.tsx", "./shell/root-layout.tsx"),
      file("src/shell/words.ts"),
      file("src/surfaces/work/board.tsx", "../../shell/words.ts"),
      file("e2e/board.e2e.ts", "../src/shell/words.ts"),
    ]),
    [],
  );
});

test("a shell file only another shell file of one surface uses is flagged with it", () => {
  assert.deepEqual(
    flagged([
      file("src/shell/work/way-back-parts.tsx"),
      file("src/shell/work/reopen-dialog.tsx", "./way-back-parts.tsx"),
      file("src/shell/work/restart-dialog.tsx", "./way-back-parts.tsx"),
      file("src/surfaces/work/run-controls.tsx", "../../shell/work/restart-dialog.tsx"),
      file("src/surfaces/work/reopen-action.tsx", "../../shell/work/reopen-dialog.tsx"),
    ]).toSorted(),
    [
      "src/shell/work/reopen-dialog.tsx work",
      "src/shell/work/restart-dialog.tsx work",
      "src/shell/work/way-back-parts.tsx work",
    ],
  );
});

test("a shell file another shell file shares further stays, through cycles too", () => {
  assert.deepEqual(
    flagged([
      file("src/shell/a.ts", "./b.ts"),
      file("src/shell/b.ts", "./a.ts"),
      file("src/surfaces/now/now-page.tsx", "../../shell/a.ts"),
      file("src/surfaces/work/board.tsx", "../../shell/b.ts"),
    ]),
    [],
  );
});

test("a shell file's own tests move with it and count as no consumer", () => {
  assert.deepEqual(
    flagged([
      file("src/shell/tags-input.tsx", "./tag-words.ts"),
      file("src/shell/tag-words.ts"),
      file("src/shell/tags-input.test.tsx", "./tags-input.tsx", "./tag-words.ts"),
      file("src/shell/tag-words.full.test.ts", "./tag-words.ts"),
      file("src/surfaces/work/board.tsx", "../../shell/tags-input.tsx"),
    ]).toSorted(),
    ["src/shell/tag-words.ts work", "src/shell/tags-input.tsx work"],
  );
});

test("a shell file another shell file's test uses stays", () => {
  assert.deepEqual(
    flagged([
      file("src/shell/user.fixtures.ts"),
      file("src/shell/time.ts"),
      file("src/shell/time.test.ts", "./time.ts", "./user.fixtures.ts"),
      file("src/surfaces/work/board.tsx", "../../shell/time.ts", "../../shell/user.fixtures.ts"),
      file("src/surfaces/now/now-page.tsx", "../../shell/time.ts"),
    ]),
    [],
  );
});

test("a shell file nobody imports is not this check's", () => {
  assert.deepEqual(flagged([file("src/shell/orphan.test.tsx", "./missing.tsx")]), []);
});

test("every kind of import names its file", () => {
  const text = [
    'import { a } from "./a.ts";',
    'import type { B } from "../b.ts";',
    'export { c } from "./c.ts";',
    'export * from "./d.ts";',
    'import "./e.css";',
    'const f = await import("./f.ts");',
    'vi.mock("./g.tsx", () => ({}));',
    'const h = await vi.importActual<typeof import("./h.ts")>("./h.ts");',
    'import url from "./i.svg?url";',
    "import {\n  j,\n} from './j.ts';",
    'import { k } from "@the-office/contracts";',
  ].join("\n");
  assert.deepEqual(relativeImportsOf({ path: "src/shell/x/y.ts", text }).toSorted(), [
    "src/shell/b.ts",
    "src/shell/x/a.ts",
    "src/shell/x/c.ts",
    "src/shell/x/d.ts",
    "src/shell/x/e.css",
    "src/shell/x/f.ts",
    "src/shell/x/g.tsx",
    "src/shell/x/h.ts",
    "src/shell/x/i.svg",
    "src/shell/x/j.ts",
  ]);
});
