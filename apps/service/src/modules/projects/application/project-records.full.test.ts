import { describe, expect, it } from "vitest";
import { aProject } from "../domain/project.fixtures.js";
import type { Project } from "../domain/project.js";
import type { BaseCheckouts } from "./base-checkouts.js";
import type { ProjectService } from "./project-service.js";
import { ProjectRecords } from "./project-records.js";

function recordsOver(projects: Project[]): ProjectRecords {
  const service: Pick<ProjectService, "list" | "find"> = {
    list: () => Promise.resolve(projects),
    find: (id) => Promise.resolve(projects.find((project) => project.id === id)),
  };
  const bases: Pick<BaseCheckouts, "list"> = {
    list: () =>
      Promise.resolve(
        projects.map((project) => ({
          projectId: project.id,
          name: project.name,
          baseBranch: project.baseBranch,
          folder: `/office/bases/${project.id}`,
        })),
      ),
  };
  return new ProjectRecords(service as ProjectService, bases as BaseCheckouts);
}

describe("ProjectRecords.of", () => {
  it("gives the Project's short record, as list_projects does", async () => {
    const records = recordsOver([aProject(), aProject({ id: "shop", name: "Shop" })]);

    expect(await records.of("admin-panel")).toBe(
      [
        "Admin panel (id admin-panel)",
        "- Base branch: main, read-only in chats at /office/bases/admin-panel",
        "- Install: `npm ci`",
        "- Commands: build (Build, build) `npm run build`, lint (Lint, lint) `npm run lint`, test (Test, test) `npm test`",
        "- Install inputs: package-lock.json",
        "- Publishing: push and open a pull request",
        "- Default Pipeline: full",
      ].join("\n"),
    );
  });

  it("is undefined for a Project The Office doesn't have", async () => {
    expect(await recordsOver([]).of("gone")).toBeUndefined();
  });
});
