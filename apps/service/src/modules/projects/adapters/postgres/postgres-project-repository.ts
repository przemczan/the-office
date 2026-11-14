import { Inject, Injectable } from "@nestjs/common";
import { asc, eq } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type { EngineModel } from "../../../engine/index.js";
import type { Project } from "../../domain/project.js";
import type { ProjectChanges } from "../../domain/project-changes.js";
import { ProjectNotFound } from "../../domain/project-not-found.js";
import { ProjectRepository } from "../../ports/project-repository.js";
import { projects } from "./projects.schema.js";
import { environmentOfStored } from "./stored-environment.js";

type ProjectRow = typeof projects.$inferSelect;

@Injectable()
export class PostgresProjectRepository extends ProjectRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async add(project: Project): Promise<void> {
    await this.database.insert(projects).values(toRow(project));
  }

  async find(id: string): Promise<Project | undefined> {
    const [row] = await this.database.select().from(projects).where(eq(projects.id, id));
    return row && toProject(row);
  }

  async list(): Promise<readonly Project[]> {
    const rows = await this.database
      .select()
      .from(projects)
      .orderBy(asc(projects.addedAt), asc(projects.id));
    return rows.map(toProject);
  }

  async update(id: string, change: (project: Project) => ProjectChanges): Promise<ProjectChanges> {
    return this.database.transaction(async (transaction) => {
      const [row] = await transaction
        .select()
        .from(projects)
        .where(eq(projects.id, id))
        .for("update");
      if (!row) throw new ProjectNotFound(id);
      const changed = change(toProject(row));
      if (changed.events.length === 0) return changed;
      await transaction.update(projects).set(toRow(changed.project)).where(eq(projects.id, id));
      return changed;
    });
  }
}

function toRow(project: Project): ProjectRow {
  return {
    id: project.id,
    name: project.name,
    path: project.path,
    repositoryUrl: project.repositoryUrl,
    baseBranch: project.baseBranch,
    markLabel: project.mark.label,
    markColour: project.mark.colour,
    icon: project.icon,
    logo: project.logo,
    installCommand: project.installCommand,
    commands: project.commands,
    installInputs: [...project.installInputs],
    publishingMode: project.publishingMode,
    beforePublishingCommand: project.beforePublishingCommand,
    afterPublishingCommand: project.afterPublishingCommand,
    defaultPipeline: project.defaultPipeline,
    environment: project.environment,
    useProjectSkills: project.useProjectSkills,
    projectSkillsOff: [...project.projectSkillsOff],
    projectDefaultEngineId: project.projectDefault?.engineId ?? null,
    projectDefaultModel: project.projectDefault?.model ?? null,
    useForEveryRole: project.useForEveryRole,
    roleOverrides: project.roleOverrides,
    runEnvironment: project.runEnvironment,
    runEnvironmentSetUpProblems: [...project.runEnvironmentSetUpProblems],
    projectLimit: project.projectLimit,
    addedAt: project.addedAt,
  };
}

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    repositoryUrl: row.repositoryUrl,
    baseBranch: row.baseBranch,
    mark: { label: row.markLabel, colour: row.markColour },
    icon: row.icon,
    logo: row.logo,
    installCommand: row.installCommand,
    commands: row.commands,
    installInputs: row.installInputs,
    publishingMode: row.publishingMode,
    beforePublishingCommand: row.beforePublishingCommand,
    afterPublishingCommand: row.afterPublishingCommand,
    defaultPipeline: row.defaultPipeline,
    environment: environmentOfStored(row.environment),
    useProjectSkills: row.useProjectSkills,
    projectSkillsOff: row.projectSkillsOff,
    projectDefault: projectDefaultOf(row),
    useForEveryRole: row.useForEveryRole,
    roleOverrides: row.roleOverrides,
    runEnvironment: row.runEnvironment,
    runEnvironmentSetUpProblems: row.runEnvironmentSetUpProblems,
    projectLimit: row.projectLimit,
    addedAt: row.addedAt,
  };
}

function projectDefaultOf(row: ProjectRow): EngineModel | null {
  const { projectDefaultEngineId: engineId, projectDefaultModel: model } = row;
  return engineId === null || model === null ? null : { engineId, model };
}
