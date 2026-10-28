import { Injectable, type OnModuleInit } from "@nestjs/common";
import { stageSchema } from "@the-office/contracts";
import {
  ProposalAppliers,
  ProposalRefused,
  type PipelineStage,
  type ProposedPipelineChange,
} from "../../../conversations/index.js";
import { PipelineLibraryEditor } from "../../application/pipeline-library-editor.js";
import type { Stage } from "../../domain/stage.js";
import { StagesEditRefused } from "../../domain/stages-edit-refused.js";
import { UnknownPipeline } from "../../domain/pipeline-library-refusals.js";

const STAGES = stageSchema.array();

/**
 * Proposals of a library Pipeline's new Stages (spec §2.3), which the library editor judges and
 * saves, refusing one whose Pipeline's Stages changed since it was drafted. Pipelines fills
 * Conversations' registry itself, since Pipelines calls Conversations.
 */
@Injectable()
export class PipelineProposals implements OnModuleInit {
  constructor(
    private readonly appliers: ProposalAppliers,
    private readonly editor: PipelineLibraryEditor,
  ) {}

  onModuleInit(): void {
    this.appliers.register("pipeline", {
      problemsWith: async ({ pipelineId, from, to }) =>
        (await this.editor.proposedStagesProblems(pipelineId, stagesOf(from), stagesOf(to))).map(
          ({ text }) => text,
        ),
      apply: (change) => this.apply(change),
    });
  }

  /** A refusal leaves the Proposal open, in the words the library editor refuses with. */
  private async apply(change: ProposedPipelineChange): Promise<ProposedPipelineChange> {
    try {
      await this.editor.saveProposedStages(
        change.pipelineId,
        stagesOf(change.from),
        stagesOf(change.to),
      );
      return change;
    } catch (error) {
      if (error instanceof StagesEditRefused) {
        throw new ProposalRefused(error.problems.map(({ text }) => text));
      }
      if (error instanceof UnknownPipeline) throw new ProposalRefused([error.message]);
      throw error;
    }
  }
}

/** Conversations keeps the Stages unread, as the Office tool gave them; they are read back here. */
function stagesOf(stages: readonly PipelineStage[]): Stage[] {
  return STAGES.parse(stages);
}
