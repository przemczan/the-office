import { randomUUID } from "node:crypto";
import {
  pipelineSchema,
  projectPipelineSchema,
  type NewProjectPipeline,
  type Pipeline,
  type ProjectPipeline,
} from "@the-office/contracts";
import { expect } from "vitest";
import { scriptStage } from "../../domain/stage.fixtures.js";
import type { ProjectDefault } from "../../ports/project-defaults.js";
import type { ProjectDefaultsForTests } from "../../ports/pipelines-ports.fixtures.js";
import { anEdit } from "./pipeline-library.controller.fixtures.js";

/** A Stage a test adds to a Project Pipeline after Tests. */
export const LINUX_CHECK = scriptStage({ key: "linux", name: "Verify on Linux", command: "test" });

/** A new Project Pipeline of `projectId`, a copy of `copyOf`, under a name of its own. */
export function aNewProjectPipeline(
  projectId: string,
  copyOf: string,
  fields: Partial<NewProjectPipeline> = {},
): NewProjectPipeline {
  return {
    projectId,
    copyOf,
    name: `With Linux check ${randomUUID()}`,
    description: "Then Linux.",
    ...fields,
  };
}

type Send = (method: string, path: string, body?: unknown) => Promise<Response>;

/**
 * The requests and Projects a Project Pipeline test makes, each of its own; `projectDefaults` reads
 * the test application's, which starts after this is made.
 */
export function projectPipelineRequests(
  send: Send,
  projectDefaults: () => ProjectDefaultsForTests,
) {
  return {
    /** An office-wide Pipeline of Implement, then Tests. */
    async anOfficeWidePipeline(): Promise<Pipeline> {
      const response = await send("POST", "/pipelines", anEdit());
      expect(response.status).toBe(201);
      return pipelineSchema.parse(await response.json());
    },

    /** A Project with a `test` command unless `commands` say otherwise; answers its id. */
    aProject(commands: readonly string[] = ["test"]): string {
      const id = randomUUID();
      projectDefaults().projects.push({
        id,
        name: `Site ${id}`,
        defaultPipeline: "full",
        commands: commands.map((key) => ({ key })),
      });
      return id;
    },

    /** Makes the Pipeline the Project's default, as Projects would; answers the Project. */
    makeDefault(projectId: string, pipelineId: string): ProjectDefault {
      const { projects } = projectDefaults();
      const index = projects.findIndex(({ id }) => id === projectId);
      const project = projects[index];
      if (!project) throw new Error(`There is no Project ${projectId}.`);
      const changed = { ...project, defaultPipeline: pipelineId };
      projects[index] = changed;
      return changed;
    },

    async added(body: NewProjectPipeline): Promise<ProjectPipeline> {
      const response = await send("POST", "/project-pipelines", body);
      expect(response.status).toBe(201);
      return projectPipelineSchema.parse(await response.json());
    },
  };
}
