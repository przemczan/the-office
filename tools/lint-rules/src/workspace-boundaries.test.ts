import assert from "node:assert/strict";
import { test } from "node:test";
import type { Workspace } from "./repository.ts";
import { workspaceBoundaryViolation } from "./workspace-boundaries.ts";

const web: Workspace = { name: "@the-office/web", directory: "apps/web", kind: "app" };
const service: Workspace = {
  name: "@the-office/service",
  directory: "apps/service",
  kind: "app",
};
const contracts: Workspace = {
  name: "@the-office/contracts",
  directory: "packages/contracts",
  kind: "package",
};
const lintRules: Workspace = {
  name: "@the-office/lint-rules",
  directory: "tools/lint-rules",
  kind: "tool",
};

test("a package is imported by its name", () => {
  assert.equal(workspaceBoundaryViolation(web, contracts, false), undefined);
  assert.match(
    workspaceBoundaryViolation(web, contracts, true) ?? "",
    /reaches into packages\/contracts by a relative path; import "@the-office\/contracts"/,
  );
});

test("an app is never imported, by name or by path", () => {
  for (const isRelative of [false, true]) {
    assert.match(
      workspaceBoundaryViolation(web, service, isRelative) ?? "",
      /apps\/service is run, never imported/,
    );
  }
  assert.match(workspaceBoundaryViolation(contracts, service, true) ?? "", /never imported/);
  assert.match(workspaceBoundaryViolation(undefined, service, true) ?? "", /never imported/);
});

test("a tool is run by the root's config files alone", () => {
  assert.equal(workspaceBoundaryViolation(undefined, lintRules, true), undefined);
  assert.match(
    workspaceBoundaryViolation(web, lintRules, true) ?? "",
    /tools\/lint-rules is run, never imported/,
  );
  assert.match(workspaceBoundaryViolation(contracts, lintRules, false) ?? "", /never imported/);
});

test("a workspace imports itself freely", () => {
  assert.equal(workspaceBoundaryViolation(service, service, true), undefined);
  assert.equal(workspaceBoundaryViolation(contracts, contracts, false), undefined);
});
