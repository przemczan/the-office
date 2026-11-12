import { useQuery } from "@tanstack/react-query";
import type { Pipeline, ProjectPipeline } from "@the-office/contracts";
import { pipelineQueries } from "../../api/pipelines.ts";

/**
 * The office-wide Pipelines and every Project's Project Pipelines as Pipelines, a Project Pipeline
 * with its built Stages, for finding the one a Task or a Project names by its id; undefined until
 * both are read, so a Project Pipeline never reads as removed meanwhile.
 */
export function useEveryPipeline(): readonly Pipeline[] | undefined {
  const officeWide = useQuery(pipelineQueries.list()).data;
  const projectPipelines = useQuery(pipelineQueries.everyProjectPipeline()).data;
  return officeWide && projectPipelines && [...officeWide, ...projectPipelines.map(asPipeline)];
}

/**
 * A Project's own Pipelines and the office-wide ones, which its Tasks and its default choose from;
 * undefined until both are read.
 */
export function useProjectPipelineChoices(projectId: string):
  | {
      readonly officeWide: readonly Pipeline[];
      readonly projectPipelines: readonly ProjectPipeline[];
    }
  | undefined {
  const officeWide = useQuery(pipelineQueries.list()).data;
  const projectPipelines = useQuery(pipelineQueries.projectPipelines(projectId)).data;
  return officeWide && projectPipelines && { officeWide, projectPipelines };
}

/** A Project Pipeline as a Task follows it: its built Stages. */
export function asPipeline({ id, name, description, stages }: ProjectPipeline): Pipeline {
  return { id, name, description, stages };
}
