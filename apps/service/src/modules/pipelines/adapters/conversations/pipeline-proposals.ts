import { Injectable, type OnModuleInit } from "@nestjs/common";
import {
  projectPipelineFieldsSchema,
  stageSchema,
  type ProjectPipelineFields as ProjectPipelineFieldsRead,
} from "@the-office/contracts";
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
import type {
  ProjectPipelineEdit,
  ProposedProjectPipeline,
} from "../../domain/project-pipeline.js";
import type { Stage } from "../../domain/stage.js";
import { StagesEditRefused } from "../../domain/stages-edit-refused.js";
import {
  UnknownPipeline,
  UnknownProjectPipeline,
  UnknownStageTemplate,
} from "../../domain/pipeline-library-refusals.js";

const STAGES = stageSchema.array();
const FIELDS = projectPipelineFieldsSchema;

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

/** Conversations keeps the Stages unread, as the Office tool gave them; they are read back here. */
function stagesOf(stages: readonly PipelineStage[]): Stage[] {
  return STAGES.parse(stages);
}

function stageOf(stage: PipelineStage): Stage {
  return stageSchema.parse(stage);
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

function editOf({ name, description, stages }: ProjectPipelineFieldsRead): ProjectPipelineEdit {
  return { name, description, stages };
}

/** Why a Proposal whose fields don't read can't be applied: what it proposed is no longer kept so. */
function changedSinceProposed({ from, to }: ProposedProjectPipelineChange): string {
  return `${from?.name ?? to.name} changed since this was proposed.`;
}

/** The Pipeline a new Project Pipeline's Proposal copies, by id. */
function copyOfIn({ to }: ProposedProjectPipelineChange): string | undefined {
  return to.copyOf;
}
