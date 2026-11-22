import type { Project } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import { issueImportOf } from "./issue-words.ts";

function aProject(id: string, codeHost: string | null, githubIssues = true): Project {
  return {
    id,
    name: id,
    codeHost,
    features: { "github-issues": githubIssues },
  } as unknown as Project;
}

const SITE = aProject("site", "GitHub");
const LOCAL = aProject("local", null);
const APP = aProject("app", "GitHub");
const SWITCHED_OFF = aProject("switched-off", "GitHub", false);

describe("Import issues from the Work board", () => {
  it("lists only the Projects on GitHub, starting on the first one the filter shows", () => {
    const shown = new Set(["local", "app"]);
    const issueImport = issueImportOf([SITE, LOCAL, APP], (id) => shown.has(id));
    expect(issueImport?.projects.map(({ id }) => id)).toEqual(["site", "app"]);
    expect(issueImport?.projectId).toBe("app");
  });

  it("doesn't show when no Project the filter shows is on GitHub", () => {
    expect(issueImportOf([SITE, LOCAL], (id) => id === "local")).toBeUndefined();
    expect(issueImportOf([LOCAL], () => true)).toBeUndefined();
  });

  it("lists only the Projects with GitHub issues switched on", () => {
    const issueImport = issueImportOf([SWITCHED_OFF, SITE], () => true);
    expect(issueImport?.projects.map(({ id }) => id)).toEqual(["site"]);
    expect(issueImport?.projectId).toBe("site");
    expect(issueImportOf([SWITCHED_OFF], () => true)).toBeUndefined();
  });
});
