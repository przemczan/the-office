import { Inject, Injectable } from "@nestjs/common";
import { asc, eq } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { forgettingReads, readKey, readOnce } from "../../../../platform/database/read-scope.js";
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
    await forgettingReads(() => this.database.insert(projects).values(toRow(project)));
  }

  find(id: string): Promise<Project | undefined> {
    return readOnce(readKey("projects.find", id), async () => {
      const [row] = await this.database.select().from(projects).where(eq(projects.id, id));
      return row && toProject(row);
    });
  }

  list(): Promise<readonly Project[]> {
    return readOnce(readKey("projects.list"), async () => {
      const rows = await this.database
        .select()
        .from(projects)
        .orderBy(asc(projects.addedAt), asc(projects.id));
      return rows.map(toProject);
    });
  }

  async update(id: string, change: (project: Project) => ProjectChanges): Promise<ProjectChanges> {
    return forgettingReads(() =>
      this.database.transaction(async (transaction) => {
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
      }),
    );
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
    featureDefaultPipeline: project.kindDefaultPipelines.feature,
    bugDefaultPipeline: project.kindDefaultPipelines.bug,
    choreDefaultPipeline: project.kindDefaultPipelines.chore,
    issueImportLabel: project.issueSettings.autoImportLabel,
    issueImportLabelSetBy: project.issueSettings.autoImportLabelSetBy,
    closeIssueOnDone: project.issueSettings.closeOnDone,
    commentOnIssue: project.issueSettings.commentOnStartAndDone,
    closeIssueOnDrop: project.issueSettings.closeOnDrop,
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
    kindDefaultPipelines: {
      feature: row.featureDefaultPipeline,
      bug: row.bugDefaultPipeline,
      chore: row.choreDefaultPipeline,
    },
    issueSettings: {
      autoImportLabel: row.issueImportLabel,
      autoImportLabelSetBy: row.issueImportLabelSetBy,
      closeOnDone: row.closeIssueOnDone,
      commentOnStartAndDone: row.commentOnIssue,
      closeOnDrop: row.closeIssueOnDrop,
    },
  };
}

function projectDefaultOf(row: ProjectRow): EngineModel | null {
  const { projectDefaultEngineId: engineId, projectDefaultModel: model } = row;
  return engineId === null || model === null ? null : { engineId, model };
}
