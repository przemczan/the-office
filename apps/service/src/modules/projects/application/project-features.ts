import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import type { Project } from "../domain/project.js";
import { asProjectChanges, changeFeatures } from "../domain/project-changes.js";
import {
  FeatureSwitchedOff,
  isFeatureOn,
  type ProjectFeature,
  type ProjectFeatureSwitches,
} from "../domain/project-features.js";
import { ProjectNotFound } from "../domain/project-not-found.js";
import { ProjectRepository } from "../ports/project-repository.js";

/**
 * Each Project's feature switches (spec §2.1.1, "Feature switches"): what other modules ask before
 * offering a feature, and the one way to change them. Run environment answers from its own setting,
 * which is changed where it always was (Run environments' route).
 */
@Injectable()
export class ProjectFeatures {
  constructor(
    private readonly repository: ProjectRepository,
    private readonly events: EventBus,
  ) {}

  /** False for a Project that isn't there. */
  async isOn(projectId: string, feature: ProjectFeature): Promise<boolean> {
    const project = await this.repository.find(projectId);
    return project !== undefined && isFeatureOn(project, feature);
  }

  /** Throws `FeatureSwitchedOff`, naming the feature and the Project, when it is off. */
  async ensureOn(projectId: string, feature: ProjectFeature): Promise<void> {
    const project = await this.repository.find(projectId);
    if (!project) throw new ProjectNotFound(projectId);
    ensureFeatureOn(project, feature);
  }

  /**
   * Refuses turning a feature on while one it needs is off; turning one off turns off those that
   * need it. Saved in one transaction with one `ProjectFeaturesChanged`.
   */
  async change(projectId: string, changes: ProjectFeatureSwitches): Promise<Project> {
    const { project, events } = await this.repository.update(projectId, (current) =>
      asProjectChanges(current, changeFeatures(current, changes)),
    );
    for (const event of events) await this.events.publish(event);
    return project;
  }
}

/** For a caller that already holds the Project. */
export function ensureFeatureOn(project: Project, feature: ProjectFeature): void {
  if (!isFeatureOn(project, feature)) throw new FeatureSwitchedOff(feature, project.name);
}
