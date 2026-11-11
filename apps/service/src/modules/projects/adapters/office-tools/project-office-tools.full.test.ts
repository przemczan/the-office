import { describe, expect, it, vi } from "vitest";
import { OfficeToolRegistry } from "../../../engine/index.js";
import type { BaseCheckouts } from "../../application/base-checkouts.js";
import type { LocalRepositories } from "../../application/local-repositories.js";
import { ProjectRecords } from "../../application/project-records.js";
import type { ProjectService } from "../../application/project-service.js";
import type { RepositoriesByUrl } from "../../application/repositories-by-url.js";
import { aProject, startingCommands } from "../../domain/project.fixtures.js";
import type { Project } from "../../domain/project.js";
import { ProjectRefused } from "../../domain/project-refused.js";
import { LIST_PROJECTS, ProjectOfficeTools, READ_REPOSITORY } from "./project-office-tools.js";
import { anOfficeToolCall } from "../../../engine/index.fixtures.js";

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
    new ProjectRecords(service as ProjectService, bases as BaseCheckouts),
    {} as LocalRepositories,
    {} as RepositoriesByUrl,
  );
}

function toolsReadingUrls(read: RepositoriesByUrl["read"]): ProjectOfficeTools {
  return new ProjectOfficeTools(
    new OfficeToolRegistry(),
    {} as ProjectRecords,
    {} as LocalRepositories,
    { read } as RepositoriesByUrl,
  );
}

function toolsReading(read: LocalRepositories["read"]): ProjectOfficeTools {
  return new ProjectOfficeTools(
    new OfficeToolRegistry(),
    {} as ProjectRecords,
    { read } as LocalRepositories,
    {} as RepositoriesByUrl,
  );
}

describe("list_projects", () => {
  it("reads each Project's record, with where a chat reads its base branch", async () => {
    const tool = toolsOver([aProject({ commands: startingCommands({ lint: "" }) })]).listProjects();

    const result = await tool.run({}, anOfficeToolCall("s-1"));

    expect(tool.name).toBe(LIST_PROJECTS);
    expect(result).toEqual({
      isError: false,
      text: [
        "Admin panel (id admin-panel)",
        "- Base branch: main, read-only in chats at /office/bases/admin-panel",
        "- Install: `npm ci`",
        "- Commands: build (Build, build) `npm run build`, lint (Lint, lint) `none`, test (Test, test) `npm test`",
        "- Install inputs: package-lock.json",
        "- Publishing: push and open a pull request",
        "- Default Pipeline: full",
      ].join("\n"),
    });
  });

  it("says so when there is no Project", async () => {
    const result = await toolsOver([]).listProjects().run({}, anOfficeToolCall("s-1"));

    expect(result.text).toBe("The Office works on no Project yet.");
  });

  it("is registered as the module starts", () => {
    const registry = new OfficeToolRegistry();
    const tools = new ProjectOfficeTools(
      registry,
      {} as ProjectRecords,
      {} as LocalRepositories,
      {} as RepositoriesByUrl,
    );

    tools.onModuleInit();

    expect(registry.named([LIST_PROJECTS, READ_REPOSITORY]).map(({ name }) => name)).toEqual([
      LIST_PROJECTS,
      READ_REPOSITORY,
    ]);
  });
});

describe("read_repository", () => {
  it("lists the branches, the top level, folders marked, then each manifest file under its name", async () => {
    const tool = toolsReading(() =>
      Promise.resolve({
        folder: "",
        entries: [
          { name: "package.json", kind: "file" },
          { name: "src", kind: "folder" },
        ],
        manifests: [{ name: "package.json", text: "{}", cut: true }],
        branches: [
          { name: "develop", checkedOut: false },
          { name: "main", checkedOut: true },
        ],
      }),
    ).readRepository();

    const result = await tool.run({ path: "/work/admin-panel" }, anOfficeToolCall("s-1"));

    expect(result).toEqual({
      isError: false,
      text: [
        "Local branches: main (checked out), develop.",
        "The repository at /work/admin-panel, at its top level:",
        "- package.json\n- src/",
        "## package.json (its start; the file goes on)\n\n{}",
      ].join("\n\n"),
    });
  });

  it("reads the folder asked for, and lists at most 30 branches, the checked-out one first", async () => {
    const branches = Array.from({ length: 40 }, (_, index) => ({
      name: `branch-${String(index).padStart(2, "0")}`,
      checkedOut: index === 35,
    }));
    const read = vi.fn<LocalRepositories["read"]>(() =>
      Promise.resolve({ folder: "apps/server", entries: [], manifests: [], branches }),
    );
    const tool = toolsReading(read).readRepository();

    const result = await tool.run(
      { path: "/work/admin-panel", folder: "apps/server" },
      anOfficeToolCall("s-1"),
    );

    expect(read).toHaveBeenCalledWith("/work/admin-panel", "apps/server");
    const [branchLine, heading] = result.text.split("\n\n");
    expect(branchLine).toMatch(
      /^Local branches: branch-35 \(checked out\), branch-00, .*branch-28 and 10 more\.$/,
    );
    expect(heading).toBe("The repository at /work/admin-panel, in apps/server:");
  });

  it("answers the Agent why it can't read the folder", async () => {
    const tool = toolsReading(() =>
      Promise.reject(new ProjectRefused(["There is no folder at /work/missing."])),
    ).readRepository();

    await expect(tool.run({ path: "/work/missing" }, anOfficeToolCall("s-1"))).resolves.toEqual({
      isError: true,
      text: "There is no folder at /work/missing.",
    });
  });

  it("reads a repository on a host by its Repository URL, the default branch first", async () => {
    const read = vi.fn<RepositoriesByUrl["read"]>(() =>
      Promise.resolve({
        url: "https://github.com/acme/shop",
        defaultBranch: "main",
        commit: "0123456789abcdef",
        branches: ["develop", "main"],
        folder: "apps/server",
        entries: [{ name: "package.json", kind: "file" }],
        manifests: [],
      }),
    );
    const tool = toolsReadingUrls(read).readRepository();

    const result = await tool.run(
      { url: "https://github.com/acme/shop", folder: "apps/server" },
      anOfficeToolCall("s-1"),
    );

    expect(read).toHaveBeenCalledWith("https://github.com/acme/shop", "apps/server");
    expect(result).toEqual({
      isError: false,
      text: [
        "Branches on the remote: main (the default), develop.",
        "The repository at https://github.com/acme/shop, its default branch main at commit 0123456, in apps/server:",
        "- package.json",
      ].join("\n\n"),
    });
  });

  it("asks for the path or the Repository URL, one of the two", async () => {
    const tool = toolsReading(() => Promise.reject(new Error("not read"))).readRepository();
    const answer = {
      isError: true,
      text: "Give the repository's path on the workstation or its Repository URL, one of the two.",
    };

    await expect(tool.run({}, anOfficeToolCall("s-1"))).resolves.toEqual(answer);
    await expect(
      tool.run(
        { path: "/work/shop", url: "https://github.com/acme/shop" },
        anOfficeToolCall("s-1"),
      ),
    ).resolves.toEqual(answer);
  });
});
