import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { moduleBoundaryViolation, modulePackageViolation } from "./module-boundaries.ts";
import { isTestFile, placeOf } from "./module-layout.ts";

function violation(importerPath: string, targetPath: string, typeOnly = false): string | undefined {
  return moduleBoundaryViolation({
    importer: placeOf(importerPath),
    importerIsTest: isTestFile(importerPath),
    target: placeOf(targetPath),
    typeOnly,
  });
}

function packageViolation(importerPath: string, packageName: string): string | undefined {
  return modulePackageViolation(placeOf(importerPath), isTestFile(importerPath), packageName);
}

describe("between modules", () => {
  test("another module is imported through its public entry", () => {
    assert.equal(
      violation("src/modules/work/application/a.ts", "src/modules/people/index.ts"),
      undefined,
    );
    assert.equal(violation("src/app.module.ts", "src/modules/work/index.js"), undefined);
  });

  test("another module's layers, wiring and other folders are private", () => {
    for (const target of [
      "src/modules/people/domain/person.js",
      "src/modules/people/ports/a.js",
      "src/modules/people/application/a.js",
      "src/modules/people/adapters/postgres/a.js",
      "src/modules/people/people.module.js",
      "src/modules/people/helpers/a.js",
    ]) {
      assert.match(
        violation("src/modules/work/application/a.ts", target) ?? "",
        /only through its public entry, modules\/people\/index\.ts/,
        target,
      );
    }
    assert.match(
      violation("src/app.module.ts", "src/modules/work/work.module.js") ?? "",
      /public entry/,
    );
  });

  test("tests are held to the module boundary too", () => {
    assert.match(
      violation("src/modules/work/application/a.test.ts", "src/modules/people/domain/b.js") ?? "",
      /public entry/,
    );
  });

  test("only tests reach another module's fixtures, through its test entry", () => {
    assert.equal(
      violation("src/modules/work/application/a.test.ts", "src/modules/people/index.fixtures.js"),
      undefined,
    );
    assert.match(
      violation("src/modules/work/application/a.ts", "src/modules/people/index.fixtures.js") ?? "",
      /public entry/,
    );
    assert.match(
      violation(
        "src/modules/work/application/a.test.ts",
        "src/modules/people/domain/b.fixtures.js",
      ) ?? "",
      /public entry/,
    );
  });

  test("a domain takes another module's public entry as types only, its values from its domain entry", () => {
    const domain = "src/modules/work/domain/a.ts";
    assert.equal(violation(domain, "src/modules/engine/index.js", true), undefined);
    assert.equal(violation(domain, "src/modules/engine/index.domain.js"), undefined);
    assert.match(
      violation(domain, "src/modules/engine/index.js") ?? "",
      /only with `import type`, and its values from modules\/engine\/index\.domain\.ts/,
    );
    assert.equal(
      violation("src/modules/work/domain/a.test.ts", "src/modules/engine/index.js"),
      undefined,
    );
    assert.equal(
      violation("src/modules/work/application/a.ts", "src/modules/engine/index.js"),
      undefined,
    );
  });

  test("a domain entry re-exports only its own module's domain", () => {
    const entry = "src/modules/engine/index.domain.ts";
    assert.equal(violation(entry, "src/modules/engine/domain/engines.js"), undefined);
    for (const target of [
      "src/modules/engine/application/a.js",
      "src/modules/engine/engine.module.js",
      "src/modules/people/index.domain.js",
      "src/platform/events/domain-event.js",
    ]) {
      assert.match(
        violation(entry, target) ?? "",
        /index\.domain\.ts re-exports only its own domain\//,
        target,
      );
    }
  });

  test("the platform imports no module, not even its entry", () => {
    assert.match(
      violation("src/platform/events/event-bus.ts", "src/modules/work/index.js") ?? "",
      /src\/platform\/ is below the modules/,
    );
  });
});

describe("inside a module", () => {
  test("a layer imports its own and the inner layers", () => {
    for (const [importer, target] of [
      ["domain/a.ts", "domain/b.js"],
      ["ports/a.ts", "domain/b.js"],
      ["application/a.ts", "ports/b.js"],
      ["application/a.ts", "domain/b.js"],
      ["adapters/http/a.ts", "application/b.js"],
      ["adapters/postgres/a.ts", "adapters/postgres/b.schema.js"],
    ] as const) {
      assert.equal(
        violation(`src/modules/work/${importer}`, `src/modules/work/${target}`),
        undefined,
      );
    }
  });

  test("a layer never imports an outer layer", () => {
    for (const [importer, target] of [
      ["domain/a.ts", "ports/b.js"],
      ["domain/a.ts", "adapters/b.js"],
      ["ports/a.ts", "application/b.js"],
      ["application/a.ts", "adapters/http/b.js"],
    ] as const) {
      assert.match(
        violation(`src/modules/work/${importer}`, `src/modules/work/${target}`) ?? "",
        /layers import only inward: adapters → application → ports → domain/,
        `${importer} → ${target}`,
      );
    }
  });

  test("the root files import every layer, and no layer imports them", () => {
    assert.equal(
      violation("src/modules/work/work.module.ts", "src/modules/work/adapters/a.js"),
      undefined,
    );
    assert.equal(
      violation("src/modules/work/index.ts", "src/modules/work/application/a.js"),
      undefined,
    );
    assert.match(
      violation("src/modules/work/application/a.ts", "src/modules/work/index.js") ?? "",
      /imports index\.ts, which wires the module or opens it to others/,
    );
  });

  test("a folder that is no layer is refused", () => {
    assert.match(
      violation("src/modules/work/application/a.ts", "src/modules/work/helpers/b.js") ?? "",
      /modules\/work\/helpers\/ is not a layer/,
    );
  });

  test("tests may wire the layers together", () => {
    assert.equal(
      violation("src/modules/work/application/a.test.ts", "src/modules/work/adapters/b.js"),
      undefined,
    );
  });
});

describe("the top-level files", () => {
  test("neither the modules nor the platform import them", () => {
    for (const importer of [
      "src/modules/work/application/a.ts",
      "src/modules/work/work.module.ts",
      "src/platform/health/health.module.ts",
    ]) {
      assert.match(
        violation(importer, "src/app.module.js") ?? "",
        /src\/app\.module\.ts is above the modules and the platform/,
        importer,
      );
    }
  });

  test("they import each other, and tests may import them", () => {
    assert.equal(violation("src/main.ts", "src/office.js"), undefined);
    assert.equal(violation("src/modules/work/adapters/a.test.ts", "src/app.module.js"), undefined);
  });
});

describe("the platform from a module", () => {
  test("domain and ports use only the domain event base class", () => {
    for (const layer of ["domain", "ports"]) {
      const importer = `src/modules/work/${layer}/a.ts`;
      assert.equal(violation(importer, "src/platform/events/domain-event.js"), undefined);
      assert.match(
        violation(importer, "src/platform/events/event-bus.js") ?? "",
        new RegExp(`${layer} uses only src/platform/events/domain-event\\.ts`),
      );
    }
  });

  test("application and adapters use all of it", () => {
    assert.equal(
      violation("src/modules/work/application/a.ts", "src/platform/events/event-bus.js"),
      undefined,
    );
    assert.equal(
      violation("src/modules/work/adapters/a.ts", "src/platform/database/database.js"),
      undefined,
    );
  });
});

describe("the contracts", () => {
  test("only adapters use them", () => {
    assert.equal(
      packageViolation("src/modules/work/adapters/http/a.ts", "@the-office/contracts"),
      undefined,
    );
    for (const layer of ["domain", "ports", "application"]) {
      assert.match(
        packageViolation(`src/modules/work/${layer}/a.ts`, "@the-office/contracts") ?? "",
        /only adapters map to and from the contracts/,
      );
    }
  });

  test("the platform and tests may use them, and other packages are not this rule's", () => {
    assert.equal(
      packageViolation("src/platform/websocket/a.ts", "@the-office/contracts"),
      undefined,
    );
    assert.equal(
      packageViolation("src/modules/work/domain/a.test.ts", "@the-office/contracts"),
      undefined,
    );
    assert.equal(packageViolation("src/modules/work/domain/a.ts", "zod"), undefined);
  });
});
