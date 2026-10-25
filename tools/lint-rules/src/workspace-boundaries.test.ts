import assert from "node:assert/strict";
import { test } from "node:test";
import type { Workspace } from "./repository.ts";
import { workspaceBoundaryViolation } from "./workspace-boundaries.ts";

const web: Workspace = { name: "@the-office/web", directory: "apps/web", isLibrary: false };
const service: Workspace = {
  name: "@the-office/service",
  directory: "apps/service",
  isLibrary: false,
};
const contracts: Workspace = {
  name: "@the-office/contracts",
  directory: "packages/contracts",
  isLibrary: true,
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

test("a workspace imports itself freely", () => {
  assert.equal(workspaceBoundaryViolation(service, service, true), undefined);
  assert.equal(workspaceBoundaryViolation(contracts, contracts, false), undefined);
});
