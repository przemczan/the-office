import { describe, expect, it } from "vitest";
import { OfficeToolRegistry } from "../../../engine/index.js";
import type { BaseCheckouts } from "../../application/base-checkouts.js";
import type { LocalRepositories } from "../../application/local-repositories.js";
import type { ProjectService } from "../../application/project-service.js";
import { aProject } from "../../domain/project.fixtures.js";
import type { Project } from "../../domain/project.js";
import { ProjectRefused } from "../../domain/project-refused.js";
import {
  LIST_PROJECTS,
  ProjectOfficeTools,
  READ_LOCAL_REPOSITORY,
} from "./project-office-tools.js";

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
    {} as LocalRepositories,
  );
}

function toolsReading(read: LocalRepositories["read"]): ProjectOfficeTools {
  return new ProjectOfficeTools(
    new OfficeToolRegistry(),
    {} as ProjectService,
    {} as BaseCheckouts,
    { read } as LocalRepositories,
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
    const tools = new ProjectOfficeTools(
      registry,
      {} as ProjectService,
      {} as BaseCheckouts,
      {} as LocalRepositories,
    );

    tools.onModuleInit();

    expect(registry.named([LIST_PROJECTS, READ_LOCAL_REPOSITORY]).map(({ name }) => name)).toEqual([
      LIST_PROJECTS,
      READ_LOCAL_REPOSITORY,
    ]);
  });
});

describe("read_local_repository", () => {
  it("lists the top level, folders marked, then each manifest file under its name", async () => {
    const tool = toolsReading(() =>
      Promise.resolve({
        entries: [
          { name: "package.json", kind: "file" },
          { name: "src", kind: "folder" },
        ],
        manifests: [{ name: "package.json", text: "{}", cut: true }],
      }),
    ).readLocalRepository();

    const result = await tool.run({ path: "/work/admin-panel" }, { sessionId: "s-1" });

    expect(result).toEqual({
      isError: false,
      text: [
        "The repository at /work/admin-panel, at its top level:",
        "- package.json\n- src/",
        "## package.json (its start; the file goes on)\n\n{}",
      ].join("\n\n"),
    });
  });

  it("answers the Agent why it can't read the folder", async () => {
    const tool = toolsReading(() =>
      Promise.reject(new ProjectRefused(["There is no folder at /work/missing."])),
    ).readLocalRepository();

    await expect(tool.run({ path: "/work/missing" }, { sessionId: "s-1" })).resolves.toEqual({
      isError: true,
      text: "There is no folder at /work/missing.",
    });
  });
});
