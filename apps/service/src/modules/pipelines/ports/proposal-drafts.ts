import type { ProjectPipelineEdit } from "../domain/project-pipeline.js";
import type { ProposedRoutes } from "../domain/proposed-routes.js";
import type { StagePosition } from "../domain/route.js";
import type { Stage } from "../domain/stage.js";

/**
 * Devops' new Stages for a library Pipeline, its whole flow, and its Stages now, as a Proposal
 * carries them, with what it does to their routes.
 */
export interface ProposedPipelineChange {
  readonly kind: "pipeline";
  readonly pipelineId: string;
  readonly from: readonly Stage[];
  readonly to: readonly Stage[];
  /** Where it puts End; undefined keeps where End stands. */
  readonly endPosition?: StagePosition;
  readonly routes: ProposedRoutes;
}

/** Devops' new Stage for a Stage template, and its Stage now, as a Proposal carries them. */
export interface ProposedStageTemplateChange {
  readonly kind: "stage-template";
  readonly templateId: string;
  readonly from: Stage;
  readonly to: Stage;
}

/**
 * A Project Pipeline's fields a Proposal gives it: its name, description and whole flow, and for a
 * new one the Pipeline it is copied from (`copyOf`, by id).
 */
export interface ProjectPipelineFields extends ProjectPipelineEdit {
  readonly copyOf?: string;
}

/**
 * Devops' new Project Pipeline of the Project, or its change to one: its fields now (`from`, null
 * for a new one) and as proposed (`to`), with what it does to the routes of its Stages.
 * `pipelineId` is null for a new one until it is applied.
 */
export interface ProposedProjectPipelineChange {
  readonly kind: "project-pipeline";
  readonly projectId: string;
  readonly pipelineId: string | null;
  readonly from: ProjectPipelineFields | null;
  readonly to: ProjectPipelineFields;
  readonly routes: ProposedRoutes;
}

/** What Pipelines drafts as a Proposal. */
export type ProposedLibraryChange =
  ProposedPipelineChange | ProposedStageTemplateChange | ProposedProjectPipelineChange;

/** The Proposals, which the Conversations module keeps; the composition root binds it. */
export abstract class ProposalDrafts {
  /**
   * Drafts the Proposal in the Thread whose engine session is `sessionId`, as its card there, for
   * the user to apply. Refused, with Conversations' own error, for a session no Thread has now and
   * for a change Pipelines would refuse to apply now.
   */
  abstract draft(
    sessionId: string,
    change: ProposedLibraryChange,
  ): Promise<{ readonly id: string }>;
}
