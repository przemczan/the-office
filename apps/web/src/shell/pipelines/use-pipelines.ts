import { useQuery } from "@tanstack/react-query";
import type { Pipeline, ProjectPipeline } from "@the-office/contracts";
import { pipelineQueries, projectPipelineQueries } from "../../api/pipelines.ts";
import type { BlockRead } from "../block-loader.tsx";

/**
 * The office-wide Pipelines and every Project's Project Pipelines as Pipelines, for finding the one
 * a Task or a Project names by its id; undefined until both are read, so a Project Pipeline never
 * reads as removed meanwhile.
 */
export function useEveryPipeline(): readonly Pipeline[] | undefined {
  return useEveryPipelineRead().pipelines;
}

/** {@link useEveryPipeline}, with the two reads behind it, for a block that shows their problem. */
export function useEveryPipelineRead(): {
  readonly pipelines: readonly Pipeline[] | undefined;
  readonly reads: readonly BlockRead[];
} {
  const officeWide = useQuery(pipelineQueries.list());
  const projectPipelines = useQuery(projectPipelineQueries.every());
  const pipelines = officeWide.data &&
    projectPipelines.data && [...officeWide.data, ...projectPipelines.data.map(asPipeline)];
  return { pipelines, reads: [officeWide, projectPipelines] };
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
  const projectPipelines = useQuery(projectPipelineQueries.list(projectId)).data;
  return officeWide && projectPipelines && { officeWide, projectPipelines };
}

/** A Project Pipeline as a Task follows it: its own Stages. */
export function asPipeline({ id, name, description, stages }: ProjectPipeline): Pipeline {
  return { id, name, description, stages };
}
