import path from "node:path";
import { describe, it } from "node:test";
import { RuleTester } from "oxlint/plugins-dev";
import plugin from "./plugin.ts";

RuleTester.describe = describe;
RuleTester.it = it;

// The rules read the workspaces from this repository; the linted files need not exist.
const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
const inRepository = (file: string): string => path.join(repositoryRoot, file);
const tester = new RuleTester({ languageOptions: { sourceType: "module" } });

const workApplication = inRepository("apps/service/src/modules/work/application/plan-task.ts");

tester.run("module-boundaries", plugin.rules["module-boundaries"], {
  valid: [
    { filename: workApplication, code: `import { PeopleDirectory } from "../../people/index.js";` },
    { filename: workApplication, code: `import { Task } from "../domain/task.js";` },
  ],
  invalid: [
    ...[
      `import { Person } from "../../people/domain/person.js";`,
      `import type { Person } from "../../people/domain/person.js";`,
      `export { Person } from "../../people/domain/person.js";`,
      `export * from "../../people/domain/person.js";`,
      `const people = await import("../../people/domain/person.js");`,
      `let person: import("../../people/domain/person.js").Person;`,
    ].map((code) => ({ filename: workApplication, code, errors: [{ message: /public entry/ }] })),
    {
      filename: workApplication,
      code: `import { TaskTable } from "../adapters/postgres/task.schema.js";`,
      errors: [{ message: /layers import only inward/ }],
    },
    {
      filename: workApplication,
      code: `import { taskAddedEventSchema } from "@the-office/contracts";`,
      errors: [{ message: /only adapters map to and from the contracts/ }],
    },
  ],
});

tester.run("workspace-boundaries", plugin.rules["workspace-boundaries"], {
  valid: [
    { filename: workApplication, code: `import { EVENTS_PATH } from "@the-office/contracts";` },
    { filename: workApplication, code: `import { readFile } from "node:fs/promises";` },
  ],
  invalid: [
    {
      filename: inRepository("packages/contracts/src/a.ts"),
      code: `import { AppModule } from "@the-office/service/src/app.module.js";`,
      errors: [{ message: /apps\/service is run, never imported/ }],
    },
    {
      filename: inRepository("packages/contracts/src/a.ts"),
      code: `import { diffJson } from "../../../tools/engine-check/src/json.ts";`,
      errors: [{ message: /tools\/engine-check is run, never imported/ }],
    },
    {
      filename: inRepository("apps/service/src/a.ts"),
      code: `import { EVENTS_PATH } from "../../../packages/contracts/src/index.js";`,
      errors: [{ message: /import "@the-office\/contracts" by its package name/ }],
    },
  ],
});

const platformLayerFile = inRepository("apps/service/src/platform/os/windows.ts");
const readsOfTheSystem = [
  `const windows = process.platform === "win32";`,
  `const windows = process["platform"] === "win32";`,
  `const windows = globalThis.process.platform === "win32";`,
  `const { platform } = process;`,
  `import { platform } from "node:os";`,
  `import { type as systemType } from "os";`,
  `import os from "node:os"; const windows = os.platform() === "win32";`,
  `import * as os from "node:os"; const linux = os.type() === "Linux";`,
];

tester.run("operating-system-branches", plugin.rules["operating-system-branches"], {
  valid: [
    ...readsOfTheSystem.map((code) => ({ filename: platformLayerFile, code })),
    ...readsOfTheSystem.map((code) => ({
      filename: inRepository("tools/engine-check/src/main.ts"),
      code,
    })),
    { filename: workApplication, code: `import { homedir } from "node:os"; homedir();` },
    { filename: workApplication, code: `const version = process.version;` },
  ],
  invalid: readsOfTheSystem.map((code) => ({
    filename: workApplication,
    code,
    errors: [
      { message: /Only apps\/service\/src\/platform\/os\/ branches on the operating system/ },
    ],
  })),
});

const hexColour = {
  selector: String.raw`Literal[value=/#[0-9a-fA-F]{3,8}\b/]`,
  message: "Raw hex color.",
};
const pxValue = { selector: String.raw`Literal[value=/\b\d+px\b/]`, message: "Raw px value." };

tester.run("restricted-syntax", plugin.rules["restricted-syntax"], {
  valid: [{ code: `const colour = "var(--fg-1)";`, options: [hexColour, pxValue] }],
  invalid: [
    {
      code: `const colour = "#fff";`,
      options: [hexColour, pxValue],
      errors: [{ message: "Raw hex color." }],
    },
    {
      code: `const border = "1px solid #fff";`,
      options: [hexColour, pxValue],
      errors: [{ message: "Raw hex color." }, { message: "Raw px value." }],
    },
    {
      code: `const colour = "#fff";`,
      options: [hexColour, { ...hexColour, message: "Use a token." }],
      errors: [{ message: "Raw hex color." }, { message: "Use a token." }],
    },
  ],
});

tester.run("web-layers", plugin.rules["web-layers"], {
  valid: [
    {
      filename: inRepository("apps/web/src/router.tsx"),
      code: `import { NowPage } from "./surfaces/now/now-page.tsx";`,
    },
    {
      filename: inRepository("apps/service/src/office.ts"),
      code: `import { AppModule } from "./app.module.js";`,
    },
  ],
  invalid: [
    {
      filename: inRepository("apps/web/src/shell/shell.tsx"),
      code: `import { NowPage } from "../surfaces/now/now-page.tsx";`,
      errors: [{ message: /The shell frames the surfaces and never imports one/ }],
    },
  ],
});
