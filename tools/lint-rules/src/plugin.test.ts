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
