import { Injectable, type OnModuleInit } from "@nestjs/common";
import { stageSchema } from "@the-office/contracts";
import {
  ProposalAppliers,
  ProposalRefused,
  type PipelineStage,
  type ProposedPipelineChange,
  type ProposedStageTemplateChange,
} from "../../../conversations/index.js";
import { PipelineLibraryEditor } from "../../application/pipeline-library-editor.js";
import { StageTemplateLibraryEditor } from "../../application/stage-template-library-editor.js";
import type { Stage } from "../../domain/stage.js";
import { StagesEditRefused } from "../../domain/stages-edit-refused.js";
import { UnknownPipeline, UnknownStageTemplate } from "../../domain/pipeline-library-refusals.js";

const STAGES = stageSchema.array();

/**
 * Proposals of a library Pipeline's new Stages and of a Stage template's new Stage (spec §2.3),
 * which their editors judge and save, refusing one whose Stages changed since it was drafted.
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
async function refusedAsProposal(save: () => Promise<unknown>): Promise<void> {
  try {
    await save();
  } catch (error) {
    if (error instanceof StagesEditRefused) {
      throw new ProposalRefused(error.problems.map(({ text }) => text));
    }
    if (error instanceof UnknownPipeline || error instanceof UnknownStageTemplate) {
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
