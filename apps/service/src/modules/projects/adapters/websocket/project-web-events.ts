import { Injectable, type OnModuleInit } from "@nestjs/common";
import type { ProjectWebEvent, RepositoryCloneWebEvent } from "@the-office/contracts";
import { WebEventForwarding } from "../../../../platform/websocket/web-event-forwarding.js";
import {
  EnvironmentCheckFinished,
  EnvironmentCheckProgressed,
  EnvironmentCheckStarted,
} from "../../domain/environment-check-events.js";
import {
  ProjectAdded,
  ProjectCommandChanged,
  ProjectDefaultChanged,
  ProjectDefaultPipelineChanged,
  ProjectEnvironmentChanged,
  ProjectImageChanged,
  ProjectInstallInputsChanged,
  ProjectLimitChanged,
  ProjectMarkChanged,
  ProjectPublishingModeChanged,
  ProjectRunEnvironmentChanged,
  ProjectRoleOverrideChanged,
  ProjectSkillUseChanged,
  ProjectUseForEveryRoleChanged,
  ProjectUseProjectSkillsChanged,
} from "../../domain/project-events.js";
import {
  RepositoryCloneFinished,
  RepositoryCloneProgressed,
  RepositoryCloneStarted,
} from "../../domain/repository-clone-events.js";

type WebEventOf<Type extends ProjectWebEvent["type"]> = Omit<
  Extract<ProjectWebEvent, { type: Type }>,
  "occurredAt"
>;

/**
 * Every Project event reaches the web, naming the Project, so an open page refetches it; a clone's
 * events name the clone.
 */
@Injectable()
export class ProjectWebEvents implements OnModuleInit {
  constructor(private readonly forwarding: WebEventForwarding) {}

  onModuleInit(): void {
    this.forwarding.forward(ProjectAdded, (event): WebEventOf<"project.added"> => ({
      type: "project.added",
      projectId: event.project.id,
    }));
    this.forwarding.forward(
      ProjectCommandChanged,
      (event): WebEventOf<"project.command-changed"> => ({
        type: "project.command-changed",
        projectId: event.projectId,
        key: event.key,
      }),
    );
    this.forwarding.forward(
      ProjectEnvironmentChanged,
      (event): WebEventOf<"project.environment-changed"> => ({
        type: "project.environment-changed",
        projectId: event.projectId,
      }),
    );
    this.forwarding.forward(EnvironmentCheckStarted, (event) =>
      checkChanged(event.check.projectId),
    );
    this.forwarding.forward(EnvironmentCheckProgressed, (event) => checkChanged(event.projectId));
    this.forwarding.forward(EnvironmentCheckFinished, (event) =>
      checkChanged(event.check.projectId),
    );
    this.forwarding.forward(
      ProjectInstallInputsChanged,
      (event): WebEventOf<"project.install-inputs-changed"> => ({
        type: "project.install-inputs-changed",
        projectId: event.projectId,
      }),
    );
    this.forwarding.forward(
      ProjectPublishingModeChanged,
      (event): WebEventOf<"project.publishing-mode-changed"> => ({
        type: "project.publishing-mode-changed",
        projectId: event.projectId,
      }),
    );
    this.forwarding.forward(
      ProjectRunEnvironmentChanged,
      (event): WebEventOf<"project.run-environment-changed"> => ({
        type: "project.run-environment-changed",
        projectId: event.projectId,
      }),
    );
    this.forwarding.forward(
      ProjectLimitChanged,
      (event): WebEventOf<"project.project-limit-changed"> => ({
        type: "project.project-limit-changed",
        projectId: event.projectId,
      }),
    );
    this.forwarding.forward(ProjectMarkChanged, (event): WebEventOf<"project.mark-changed"> => ({
      type: "project.mark-changed",
      projectId: event.projectId,
    }));
    this.forwarding.forward(ProjectImageChanged, (event): WebEventOf<"project.image-changed"> => ({
      type: "project.image-changed",
      projectId: event.projectId,
      key: event.key,
    }));
    this.forwarding.forward(
      ProjectUseProjectSkillsChanged,
      (event): WebEventOf<"project.use-project-skills-changed"> => ({
        type: "project.use-project-skills-changed",
        projectId: event.projectId,
      }),
    );
    this.forwarding.forward(
      ProjectSkillUseChanged,
      (event): WebEventOf<"project.skill-use-changed"> => ({
        type: "project.skill-use-changed",
        projectId: event.projectId,
      }),
    );
    this.forwarding.forward(
      ProjectDefaultPipelineChanged,
      (event): WebEventOf<"project.default-pipeline-changed"> => ({
        type: "project.default-pipeline-changed",
        projectId: event.projectId,
      }),
    );
    this.forwarding.forward(
      ProjectDefaultChanged,
      (event): WebEventOf<"project.project-default-changed"> => ({
        type: "project.project-default-changed",
        projectId: event.projectId,
      }),
    );
    this.forwarding.forward(
      ProjectUseForEveryRoleChanged,
      (event): WebEventOf<"project.use-for-every-role-changed"> => ({
        type: "project.use-for-every-role-changed",
        projectId: event.projectId,
      }),
    );
    this.forwarding.forward(
      ProjectRoleOverrideChanged,
      (event): WebEventOf<"project.role-override-changed"> => ({
        type: "project.role-override-changed",
        projectId: event.projectId,
      }),
    );
    this.forwarding.forward(RepositoryCloneStarted, (event) => cloneChanged(event.clone.id));
    this.forwarding.forward(RepositoryCloneProgressed, (event) => cloneChanged(event.cloneId));
    this.forwarding.forward(RepositoryCloneFinished, (event) => cloneChanged(event.clone.id));
  }
}

function cloneChanged(cloneId: string): Omit<RepositoryCloneWebEvent, "occurredAt"> {
  return { type: "repository-clone.changed", cloneId };
}

function checkChanged(projectId: string): WebEventOf<"project.environment-check-changed"> {
  return { type: "project.environment-check-changed", projectId };
}
