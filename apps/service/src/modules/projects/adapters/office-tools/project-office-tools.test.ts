import { describe, expect, it } from "vitest";
import { OfficeToolRegistry } from "../../../engine/index.js";
import type { BaseCheckouts } from "../../application/base-checkouts.js";
import type { ProjectService } from "../../application/project-service.js";
import { aProject } from "../../domain/project.fixtures.js";
import type { Project } from "../../domain/project.js";
import { LIST_PROJECTS, ProjectOfficeTools } from "./project-office-tools.js";

function toolsOver(projects: Project[]): ProjectOfficeTools {
  const service: Pick<ProjectService, "list"> = { list: () => Promise.resolve(projects) };
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
  return new ProjectOfficeTools(
    new OfficeToolRegistry(),
    service as ProjectService,
    bases as BaseCheckouts,
  );
}

describe("list_projects", () => {
  it("reads each Project's record, with where a chat reads its base branch", async () => {
    const tool = toolsOver([
      aProject({ commands: { ...aProject().commands, lint: "" } }),
    ]).listProjects();

    const result = await tool.run({}, { sessionId: "s-1" });

    expect(tool.name).toBe(LIST_PROJECTS);
    expect(result).toEqual({
      isError: false,
      text: [
        "Admin panel (id admin-panel)",
        "- Base branch: main, read-only in chats at /office/bases/admin-panel",
        "- Commands: install `npm ci`, build `npm run build`, lint `none`, test `npm test`",
        "- Install inputs: package-lock.json",
        "- Publishing: push and open a pull request",
        "- Default Pipeline: full",
      ].join("\n"),
    });
  });

  it("says so when there is no Project", async () => {
    const result = await toolsOver([]).listProjects().run({}, { sessionId: "s-1" });

    expect(result.text).toBe("The Office works on no Project yet.");
  });

  it("is registered as the module starts", () => {
    const registry = new OfficeToolRegistry();
    const tools = new ProjectOfficeTools(registry, {} as ProjectService, {} as BaseCheckouts);

    tools.onModuleInit();

    expect(registry.named([LIST_PROJECTS]).map(({ name }) => name)).toEqual([LIST_PROJECTS]);
  });
});
