import { Injectable } from "@nestjs/common";
import { readEach } from "../../../platform/database/fan-out.js";
import type { EngineModel } from "../../engine/index.js";
import { ProjectServerValues, type ProjectMcpServerValues } from "../../mcp-servers/index.js";
import type { EnvironmentCheck } from "../domain/environment-check.js";
import type { Project, RunEnvironmentSetting } from "../domain/project.js";
import type { ProjectEnvironment } from "../domain/project-environment.js";
import { BaseCheckouts } from "./base-checkouts.js";
import { EnvironmentChecks } from "./environment-checks.js";
import { ProjectService } from "./project-service.js";

/** What The Office reads of a Project beyond its own row, for its record. */
interface ProjectSurroundings {
  readonly checkout: string | undefined;
  readonly environmentCheck: EnvironmentCheck | undefined;
  readonly serverValues: readonly ProjectMcpServerValues[];
}

const RUN_ENVIRONMENT_WORDS: Readonly<Record<RunEnvironmentSetting, string>> = {
  "not-decided": "not decided yet",
  on: "on",
  off: "off",
};

/**
 * The Projects' records as an Agent reads them: `list_projects` gives them all, and a chat message
 * sent beside a Project's page gives its own (spec §2.4). Each holds what the Project's page shows,
 * a Secret variable's and a secret Server value's value left out (spec §6).
 */
@Injectable()
export class ProjectRecords {
  constructor(
    private readonly projects: ProjectService,
    private readonly bases: BaseCheckouts,
    private readonly environmentChecks: EnvironmentChecks,
    private readonly serverValues: ProjectServerValues,
  ) {}

  /** Every Project's record, or that there is none. */
  async everyone(): Promise<string> {
    const projects = await this.projects.list();
    if (projects.length === 0) return "The Office works on no Project yet.";
    const checkouts = await this.checkoutFolders();
    const records = await readEach(projects, async (project) =>
      projectRecord(project, await this.surroundingsOf(project, checkouts)),
    );
    return records.join("\n\n");
  }

  /** The Project's record; undefined when The Office has no such Project. */
  async of(projectId: string): Promise<string | undefined> {
    const project = await this.projects.find(projectId);
    if (!project) return undefined;
    return projectRecord(project, await this.surroundingsOf(project, await this.checkoutFolders()));
  }

  private async surroundingsOf(
    project: Project,
    checkouts: ReadonlyMap<string, string>,
  ): Promise<ProjectSurroundings> {
    const [environmentCheck, serverValues] = await Promise.all([
      this.environmentChecks.latest(project.id),
      this.serverValues.of(project.id),
    ]);
    return { checkout: checkouts.get(project.id), environmentCheck, serverValues };
  }

  private async checkoutFolders(): Promise<ReadonlyMap<string, string>> {
    return new Map(
      (await this.bases.list()).map((checkout) => [checkout.projectId, checkout.folder]),
    );
  }
}

function projectRecord(project: Project, surroundings: ProjectSurroundings): string {
  const { checkout, environmentCheck, serverValues } = surroundings;
  const commands = project.commands.map(
    ({ key, name, kind, commandLine }) => `${key} (${name}, ${kind}) \`${commandLine || "none"}\``,
  );
  return [
    `${project.name} (id ${project.id})`,
    `- Path: ${project.path}${project.repositoryUrl ? `, cloned from ${project.repositoryUrl}` : ""}`,
    `- Base branch: ${project.baseBranch}${checkout ? `, read-only in chats at ${checkout}` : ""}`,
    `- Install: \`${project.installCommand || "none"}\``,
    `- Commands: ${commands.length > 0 ? commands.join(", ") : "none"}`,
    `- Install inputs: ${listed(project.installInputs)}`,
    `- Publishing: ${project.publishingMode === "merge" ? `merge into ${project.baseBranch}` : "push and open a pull request"}`,
    `- Before publishing: \`${project.beforePublishingCommand || "none"}\``,
    `- After publishing: \`${project.afterPublishingCommand || "none"}\``,
    `- Default Pipeline: ${project.defaultPipeline}`,
    `- Project limit: ${project.projectLimit} Task${project.projectLimit === 1 ? "" : "s"} started at once`,
    `- Run environment: ${RUN_ENVIRONMENT_WORDS[project.runEnvironment]}`,
    ...environmentLines(project.environment),
    `- Environment check: ${environmentCheckWords(environmentCheck)}`,
    ...engineLines(project),
    `- Project skills: ${projectSkillsWords(project)}`,
    `- Server values: ${serverValuesWords(serverValues)}`,
  ].join("\n");
}

function environmentLines({ set, unset, prependPath }: ProjectEnvironment): string[] {
  const plain = set.filter((variable) => !variable.secret);
  const secrets = set.filter((variable) => variable.secret);
  return [
    `- Variables to set: ${listed(plain.map(({ name, value }) => `\`${name}=${value}\``))}`,
    `- Secret variables (values never shown): ${listed(
      secrets.map(({ name, value }) => `${name} (${value === "" ? "no value" : "value set"})`),
    )}`,
    `- Variables to remove: ${listed(unset)}`,
    `- Folders in front of PATH: ${listed(prependPath)}`,
  ];
}

function environmentCheckWords(check: EnvironmentCheck | undefined): string {
  if (!check) return "never run";
  if (check.state === "running") return `running since ${check.startedAt.toISOString()}`;
  const finished = `${check.state}, ${(check.finishedAt ?? check.startedAt).toISOString()}`;
  const failed = check.checks
    .filter((each) => each.state === "failed")
    .map((each) => (each.step === "command" ? each.key : each.step));
  return failed.length > 0 ? `${finished}; failed: ${failed.join(", ")}` : finished;
}

function engineLines(project: Project): string[] {
  const overrides = project.roleOverrides.map(
    (override) => `${override.roleKey} on ${engineModelWords(override)}`,
  );
  return [
    `- Project default engine: ${project.projectDefault ? engineModelWords(project.projectDefault) : "none, the Office default applies"}${project.useForEveryRole ? ", used for every Role" : ""}`,
    `- Role overrides: ${listed(overrides)}`,
  ];
}

function engineModelWords({ engineId, model }: EngineModel): string {
  return `engine ${engineId}, model ${model}`;
}

function projectSkillsWords({ useProjectSkills, projectSkillsOff }: Project): string {
  if (!useProjectSkills) return "not used";
  return projectSkillsOff.length > 0 ? `used, but off: ${projectSkillsOff.join(", ")}` : "used";
}

function serverValuesWords(servers: readonly ProjectMcpServerValues[]): string {
  const values = servers.flatMap(({ serverName, serverValues }) =>
    serverValues.map(({ serverValue, projectValue }) => {
      const name = `${serverName} ${serverValue.name}`;
      if (projectValue === undefined) {
        return `${name}: ${serverValue.officeWideValue === undefined ? "not set" : "the Office-wide value"}`;
      }
      return `${name}: ${serverValue.secret ? "the Project's own secret value" : `the Project's own \`${projectValue}\``}`;
    }),
  );
  return listed(values);
}

function listed(items: readonly string[]): string {
  return items.length > 0 ? items.join(", ") : "none";
}
