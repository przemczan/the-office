import { Inject, Injectable } from "@nestjs/common";
import { asc, eq } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type { DomainEvent } from "../../../../platform/events/domain-event.js";
import type { Project } from "../../domain/project.js";
import type { ProjectChange } from "../../domain/project-changes.js";
import { ProjectNotFound } from "../../domain/project-not-found.js";
import { ProjectRepository, type ProjectUpdate } from "../../ports/project-repository.js";
import { projects } from "./projects.schema.js";

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

  async update<Event extends DomainEvent>(
    id: string,
    change: (project: Project) => ProjectChange<Event> | undefined,
  ): Promise<ProjectUpdate<Event>> {
    return this.database.transaction(async (transaction) => {
      const [row] = await transaction
        .select()
        .from(projects)
        .where(eq(projects.id, id))
        .for("update");
      if (!row) throw new ProjectNotFound(id);
      const project = toProject(row);
      const changed = change(project);
      if (!changed) return { project, event: undefined };
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
    baseBranch: project.baseBranch,
    markLabel: project.mark.label,
    markColour: project.mark.colour,
    installCommand: project.commands.install,
    buildCommand: project.commands.build,
    lintCommand: project.commands.lint,
    testCommand: project.commands.test,
    publishingMode: project.publishingMode,
    defaultPipeline: project.defaultPipeline,
    useProjectSkills: project.useProjectSkills,
    addedAt: project.addedAt,
  };
}

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    baseBranch: row.baseBranch,
    mark: { label: row.markLabel, colour: row.markColour },
    commands: {
      install: row.installCommand,
      build: row.buildCommand,
      lint: row.lintCommand,
      test: row.testCommand,
    },
    publishingMode: row.publishingMode,
    defaultPipeline: row.defaultPipeline,
    useProjectSkills: row.useProjectSkills,
    addedAt: row.addedAt,
  };
}
