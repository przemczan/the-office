import { describe, expect, it } from "vitest";
import type { EventBus } from "../../../platform/events/event-bus.js";
import { aProject } from "../domain/project.fixtures.js";
import type { Project } from "../domain/project.js";
import type { ProjectChanges } from "../domain/project-changes.js";
import { ProjectRefused } from "../domain/project-refused.js";
import type { SettingChangedBy } from "../domain/project-setting-change.js";
import type { SettingChangeToRecord } from "../domain/project-setting-change.js";
import type { SettingChangeRecording } from "../domain/setting-change-summaries.js";
import { ProjectRepository } from "../ports/project-repository.js";
import type { ProjectChecks } from "./project-checks.js";
import { ProjectService } from "./project-service.js";

const BY: SettingChangedBy = { kind: "user", user: { userId: "u1", name: "Ada" } };

const E2E = {
  key: "e2e",
  name: "End to end",
  kind: "test",
  commandLine: "npm run e2e",
  rerunCommandLine: "",
} as const;

/** Keeps one Project in memory, holding it as the real repository does: the change, then the save. */
class MemoryProjects extends ProjectRepository {
  saved: Project;
  recorded: SettingChangeToRecord[] = [];

  constructor(project: Project) {
    super();
    this.saved = project;
  }

  add = () => Promise.resolve();
  find = (id: string) => Promise.resolve(id === this.saved.id ? this.saved : undefined);
  list = () => Promise.resolve([this.saved]);

  update(
    _id: string,
    change: (project: Project) => ProjectChanges,
    record?: SettingChangeRecording<Project>,
  ): Promise<ProjectChanges> {
    const changes = change(this.saved);
    if (changes.events.length > 0) {
      if (typeof record === "object") this.recorded.push(record);
      this.saved = changes.project;
    }
    return Promise.resolve(changes);
  }
}

/** ProjectService over a Project in memory; `used` are the commands a default Pipeline runs. */
function serviceWith(used: readonly string[] = []) {
  const repository = new MemoryProjects(aProject());
  const checks = {
    commandRemovalProblems: (_project: unknown, keys: readonly string[]) =>
      Promise.resolve(
        keys.filter((key) => used.includes(key)).map((key) => `The full Pipeline runs ${key}.`),
      ),
  } as unknown as ProjectChecks;
  const events = { publish: () => Promise.resolve() } as unknown as EventBus;
  const none = undefined as never;
  const service = new ProjectService(
    repository,
    checks,
    none,
    events,
    none,
    none,
    none,
    none,
    none,
  );
  return { service, repository };
}

async function reasonsOf(attempt: Promise<unknown>): Promise<readonly string[]> {
  try {
    await attempt;
  } catch (error) {
    if (error instanceof ProjectRefused) return error.reasons;
    throw error;
  }
  throw new Error("Expected a refusal.");
}

describe("ProjectService.changeCommands", () => {
  it("applies every edit under one hold, recorded once", async () => {
    const { service, repository } = serviceWith();

    const project = await service.changeCommands(
      "admin-panel",
      [
        { kind: "add", command: E2E },
        { kind: "remove", key: "lint" },
      ],
      BY,
    );

    expect(project.commands.map(({ key }) => key)).toEqual(["build", "test", "e2e"]);
    expect(repository.recorded).toEqual([
      { setting: "commands", summary: "changed Commands", by: BY },
    ]);
  });

  it("changes nothing when one edit among several is refused", async () => {
    const { service, repository } = serviceWith();
    const before = repository.saved;

    const reasons = await reasonsOf(
      service.changeCommands(
        "admin-panel",
        [
          { kind: "add", command: E2E },
          { kind: "remove", key: "lint" },
          { kind: "add", command: { ...E2E, key: "build" } },
        ],
        BY,
      ),
    );

    expect(reasons).toEqual(['The Project already has a command with the key "build".']);
    expect(repository.saved).toBe(before);
    expect(repository.recorded).toEqual([]);
  });

  it("changes nothing when a command a default Pipeline runs is among those removed", async () => {
    const { service, repository } = serviceWith(["test"]);
    const before = repository.saved;

    const reasons = await reasonsOf(
      service.changeCommands(
        "admin-panel",
        [
          { kind: "add", command: E2E },
          { kind: "remove", key: "test" },
        ],
        BY,
      ),
    );

    expect(reasons).toEqual(["The full Pipeline runs test."]);
    expect(repository.saved).toBe(before);
  });
});

describe("a command route and the Agents' tool refuse alike", () => {
  it("refuses a key the Project has with the same reasons", async () => {
    const duplicate = { ...E2E, key: "build" };

    const route = await reasonsOf(serviceWith().service.addCommand("admin-panel", duplicate, BY));
    const tool = await reasonsOf(
      serviceWith().service.changeCommands(
        "admin-panel",
        [{ kind: "add", command: duplicate }],
        BY,
      ),
    );
    const asked = await serviceWith().service.commandEditsProblems("admin-panel", [
      { kind: "add", command: duplicate },
    ]);

    expect(route).toEqual(['The Project already has a command with the key "build".']);
    expect(tool).toEqual(route);
    expect(asked).toEqual(route);
  });

  it("refuses removing a command a Pipeline runs with the same reasons", async () => {
    const route = await reasonsOf(
      serviceWith(["test"]).service.removeCommand("admin-panel", "test", BY),
    );
    const tool = await reasonsOf(
      serviceWith(["test"]).service.changeCommands(
        "admin-panel",
        [{ kind: "remove", key: "test" }],
        BY,
      ),
    );
    const asked = await serviceWith(["test"]).service.commandEditsProblems("admin-panel", [
      { kind: "remove", key: "test" },
    ]);

    expect(route).toEqual(["The full Pipeline runs test."]);
    expect(tool).toEqual(route);
    expect(asked).toEqual(route);
  });
});
