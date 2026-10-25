import type { DomainEvent } from "../../../platform/events/domain-event.js";
import type { Project } from "../domain/project.js";
import type { ProjectChange } from "../domain/project-changes.js";

/** The Project after an update, with the change's event, or undefined when nothing changed. */
export interface ProjectUpdate<Event extends DomainEvent> {
  readonly project: Project;
  readonly event: Event | undefined;
}

/** Where Projects are kept. */
export abstract class ProjectRepository {
  abstract add(project: Project): Promise<void>;

  abstract find(id: string): Promise<Project | undefined>;

  /** Every Project, in the order they were added. */
  abstract list(): Promise<readonly Project[]>;

  /**
   * Applies `change` to the Project as stored, holding it against other changes until the result
   * is saved, so two changes at once never lose one. Saves nothing when `change` returns
   * undefined; throws ProjectNotFound when there is no such Project.
   */
  abstract update<Event extends DomainEvent>(
    id: string,
    change: (project: Project) => ProjectChange<Event> | undefined,
  ): Promise<ProjectUpdate<Event>>;
}
