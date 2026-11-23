import { Injectable, type OnModuleInit } from "@nestjs/common";
import {
  projectPipelineFieldsSchema,
  proposedRoutesSchema,
  stageSchema,
  type Route,
} from "@the-office/contracts";
import { z } from "zod";
import {
  ProposalAppliers,
  ProposalRefused,
  type PipelineStage,
  type ProposedPipelineChange,
  type ProposedProjectPipelineChange,
  type ProposedStageTemplateChange,
} from "../../../conversations/index.js";
import { PipelineLibraryEditor } from "../../application/pipeline-library-editor.js";
import { StageTemplateLibraryEditor } from "../../application/stage-template-library-editor.js";
import {
  asFlow,
  isRouteBack,
  placedInOrder,
  withGivenLimits,
  type FlowStage,
} from "../../domain/flow.js";
import {
  UnknownPipeline,
  UnknownProjectPipeline,
  UnknownStageTemplate,
} from "../../domain/pipeline-library-refusals.js";
import type {
  ProjectPipelineEdit,
  ProposedProjectPipeline,
} from "../../domain/project-pipeline.js";
import { routeChangesOf } from "../../domain/proposed-routes.js";
import { defaultRouteLimit } from "../../domain/route.js";
import type { KeptStage } from "../../domain/routes-back.js";
import type { Stage } from "../../domain/stage.js";
import { StagesEditRefused } from "../../domain/stages-edit-refused.js";
import { givenStage } from "../http/given-stages.js";

/**
 * A Stage as a Proposal keeps it: one drafted by a previous release may hold its on-failure
 * setting, which the contract no longer has, so it is read here rather than stripped, for `asFlow`
 * to read as a failure route back (`withRoutesBack`).
 */
const KEPT_STAGE = stageSchema.and(
  z.object({
    onFailure: z.object({ goBackTo: z.string().min(1), rounds: z.int().positive() }).optional(),
  }),
);
const KEPT_STAGES = KEPT_STAGE.array();
const FIELDS = projectPipelineFieldsSchema.extend({ stages: KEPT_STAGES });

/**
 * Proposals of a library Pipeline's new Stages, of a Stage template's new Stage and of a Project
 * Pipeline, new or changed (spec §2.3), which their editors judge and save, refusing one whose
 * Stages or fields changed since it was drafted.
 * Pipelines fills Conversations' registry itself, since Pipelines calls Conversations.
 */
@Injectable()
export class PipelineProposals implements OnModuleInit {
  constructor(
    private readonly appliers: ProposalAppliers,
    private readonly editor: PipelineLibraryEditor,
    private readonly templateEditor: StageTemplateLibraryEditor,
  ) {}

  onModuleInit(): void {
    this.appliers.register("pipeline", {
      problemsWith: async ({ pipelineId, from, to }) =>
        (await this.editor.proposedStagesProblems(pipelineId, stagesOf(from), stagesOf(to))).map(
          ({ text }) => text,
        ),
      apply: (change) => this.applyPipeline(change),
      shown: shownPipelineChange,
    });
    this.appliers.register("stage-template", {
      problemsWith: async ({ templateId, from, to }) =>
        (
          await this.templateEditor.proposedStageProblems(templateId, stageOf(from), stageOf(to))
        ).map(({ text }) => text),
      apply: (change) => this.applyStageTemplate(change),
    });
    this.appliers.register("project-pipeline", {
      problemsWith: async (change) => {
        const proposed = proposedOf(change);
        if (!proposed) return [changedSinceProposed(change)];
        return (await this.editor.proposedProjectPipelineProblems(proposed, copyOfIn(change))).map(
          ({ text }) => text,
        );
      },
      apply: (change) => this.applyProjectPipeline(change),
      shown: shownProjectPipelineChange,
    });
  }

  /** Answers the change with the Project Pipeline it added or saved. */
  private async applyProjectPipeline(
    change: ProposedProjectPipelineChange,
  ): Promise<ProposedProjectPipelineChange> {
    const proposed = proposedOf(change);
    if (!proposed) throw new ProposalRefused([changedSinceProposed(change)]);
    const projectPipeline = await refusedAsProposal(() =>
      this.editor.saveProposedProjectPipeline(proposed, copyOfIn(change)),
    );
    return { ...change, pipelineId: projectPipeline.id };
  }

  private async applyPipeline(change: ProposedPipelineChange): Promise<ProposedPipelineChange> {
    await refusedAsProposal(() =>
      this.editor.saveProposedStages(change.pipelineId, stagesOf(change.from), stagesOf(change.to)),
    );
    return change;
  }

  private async applyStageTemplate(
    change: ProposedStageTemplateChange,
  ): Promise<ProposedStageTemplateChange> {
    await refusedAsProposal(() =>
      this.templateEditor.saveProposedStage(
        change.templateId,
        stageOf(change.from),
        stageOf(change.to),
      ),
    );
    return change;
  }
}

/** A refusal leaves the Proposal open, in the words the editor refuses with. */
async function refusedAsProposal<Saved>(save: () => Promise<Saved>): Promise<Saved> {
  try {
    return await save();
  } catch (error) {
    if (error instanceof StagesEditRefused) {
      throw new ProposalRefused(error.problems.map(({ text }) => text));
    }
    if (
      error instanceof UnknownPipeline ||
      error instanceof UnknownProjectPipeline ||
      error instanceof UnknownStageTemplate
    ) {
      throw new ProposalRefused([error.message]);
    }
    throw error;
  }
}

/**
 * Conversations keeps the Stages unread, as the Office tool gave them; they are read back here, each
 * route kept without a limit (one drafted before routes had them) taking the default for where it
 * leads, and a kept on-failure setting left for `asFlow` to read.
 */
function stagesOf(stages: readonly PipelineStage[]): KeptStage[] {
  return keptStages(KEPT_STAGES.parse(stages));
}

/** A Stage template's Stage, whose on-failure setting, never kept on a template, is dropped. */
function stageOf(stage: PipelineStage): Stage {
  return givenStage(stageSchema.parse(stage));
}

/** `stages` as the domain takes them, each keeping its on-failure setting. */
function keptStages(stages: readonly z.infer<typeof KEPT_STAGE>[]): KeptStage[] {
  const limited = withGivenLimits(stages);
  return stages.map(({ onFailure }, index) => {
    const stage = limited[index];
    if (!stage) throw new Error("Each Stage reads as one Stage.");
    return onFailure === undefined ? stage : { ...stage, onFailure };
  });
}

/**
 * The Proposal as the editor judges it, its fields read back; undefined for one drafted before
 * Project Pipelines held their own flow, whose base Pipeline and Stage changes don't read.
 */
function proposedOf(change: ProposedProjectPipelineChange): ProposedProjectPipeline | undefined {
  const from = change.from && FIELDS.safeParse(change.from);
  const to = FIELDS.safeParse(change.to);
  if ((from && !from.success) || !to.success) return undefined;
  return {
    projectId: change.projectId,
    pipelineId: change.pipelineId,
    from: from ? editOf(from.data) : null,
    to: editOf(to.data),
  };
}

function editOf({ name, description, stages }: z.infer<typeof FIELDS>): ProjectPipelineEdit {
  return { name, description, stages: keptStages(stages) };
}

/** Why a Proposal whose fields don't read can't be applied: what it proposed is no longer kept so. */
function changedSinceProposed({ from, to }: ProposedProjectPipelineChange): string {
  return `${from?.name ?? to.name} changed since this was proposed.`;
}

/** The Pipeline a new Project Pipeline's Proposal copies, by id. */
function copyOfIn({ to }: ProposedProjectPipelineChange): string | undefined {
  return to.copyOf;
}

/**
 * A Proposal of a library Pipeline as its card shows it (spec §2.3, "Route and condition
 * Proposals"): its Stages as applying it reads them (`shownFlow`), and its route changes weighed
 * again between them, so one a previous release kept shows its on-failure setting as the failure
 * route back it applies as, and every route with its limit. The check stays as drafted.
 */
function shownPipelineChange(change: ProposedPipelineChange): ProposedPipelineChange {
  const from = shownFlow(change.from);
  const to = shownFlow(change.to);
  if (!from || !to) return change;
  return {
    ...change,
    from,
    to,
    ...(change.routes && { routes: { ...change.routes, stages: shownRouteChanges(from, to) } }),
  };
}

/**
 * A Proposal of a Project Pipeline as its card shows it, as `shownPipelineChange` shows a library
 * Pipeline's. A new one's route changes are from the Pipeline it copies, which it doesn't keep, so
 * only their limits are set, each route kept without one taking the default for where it leads in
 * the proposed flow. One whose fields don't read shows as it is.
 */
function shownProjectPipelineChange(
  change: ProposedProjectPipelineChange,
): ProposedProjectPipelineChange {
  const fromStages = change.from && shownFlow(change.from.stages);
  const toStages = shownFlow(change.to.stages);
  if (fromStages === undefined || !toStages) return change;
  const from = change.from && fromStages && { ...change.from, stages: fromStages };
  const to = { ...change.to, stages: toStages };
  if (!change.routes) return { ...change, from, to };
  const routes = fromStages
    ? { ...change.routes, stages: shownRouteChanges(fromStages, toStages) }
    : withRouteLimits(change.routes, toStages);
  return { ...change, from, to, routes };
}

/**
 * Kept Stages as a flow, as applying reads them, in the order and with the names they were kept
 * with; undefined when they don't read.
 */
function shownFlow(stages: readonly PipelineStage[]): FlowStage[] | undefined {
  const read = KEPT_STAGES.safeParse(stages);
  return read.success ? asFlow(keptStages(read.data)) : undefined;
}

/** The route changes between two flows as the propose tools draft them, each route naming its Stages. */
function shownRouteChanges(from: readonly FlowStage[], to: readonly FlowStage[]) {
  return routeChangesOf(placedInOrder(from), placedInOrder(to));
}

/**
 * Kept route changes, each route kept without a limit taking the default for where it leads in
 * `flow`.
 */
function withRouteLimits(routes: object, flow: readonly FlowStage[]): object {
  const read = proposedRoutesSchema.safeParse(routes);
  if (!read.success) return routes;
  const limited = (stageKey: string, stageRoutes: readonly Route[]) =>
    stageRoutes.map((route) => ({
      ...route,
      limit:
        route.limit === undefined
          ? defaultRouteLimit(isRouteBack(flow, stageKey, route.to))
          : route.limit,
    }));
  return {
    ...read.data,
    stages: read.data.stages.map((stage) => ({
      ...stage,
      from: limited(stage.stageKey, stage.from),
      to: limited(stage.stageKey, stage.to),
    })),
  };
}
