import { Injectable, type OnModuleInit } from "@nestjs/common";
import { stageSchema } from "@the-office/contracts";
import { z } from "zod";
import {
  LIST_PIPELINES_TOOL,
  PROPOSE_LIBRARY_PIPELINE_TOOL,
  ProposalRefused,
} from "../../../conversations/index.js";
import { OfficeToolRegistry, type OfficeToolResult } from "../../../engine/index.js";
import { PipelineLibrary } from "../../application/pipeline-library.js";
import { ProposalDrafts } from "../../ports/proposal-drafts.js";
import { toPipelineResponse } from "../http/pipeline-responses.js";

const DRAFTED =
  "The Proposal is in this Thread as a card, with the Pipeline's Stages now and as proposed; nothing changes until the user applies it, and it is refused if the Stages change first. Don't wait for it: tell the user what you propose and why, in a line or two.";

/**
 * The Office tools Devops reads the Pipeline library and proposes a library Pipeline's new Stages
 * with (spec §2.3). Proposing changes nothing itself, so it sits behind no Hard switch: the user's
 * click on the Proposal is the approval. Both return at once.
 */
@Injectable()
export class PipelineOfficeTools implements OnModuleInit {
  constructor(
    private readonly registry: OfficeToolRegistry,
    private readonly library: PipelineLibrary,
    private readonly proposals: ProposalDrafts,
  ) {}

  onModuleInit(): void {
    this.registerListPipelines();
    this.registerProposePipeline();
  }

  private registerListPipelines(): void {
    this.registry.register({
      name: LIST_PIPELINES_TOOL,
      description:
        "Lists the Pipeline library: each Pipeline's id, name, description and Stages, as JSON in the shape propose_pipeline takes them.",
      input: z.object({}),
      run: async () => ({
        text: JSON.stringify((await this.library.list()).map(toPipelineResponse), null, 2),
        isError: false,
      }),
    });
  }

  private registerProposePipeline(): void {
    this.registry.register({
      name: PROPOSE_LIBRARY_PIPELINE_TOOL,
      description:
        "Drafts new Stages for a library Pipeline as a Proposal the user applies with a click; its name and description stay. It shows in this Thread as a card, with the Stages now and the ones proposed, and changes nothing until the user applies it. It returns at once.",
      input: z.object({
        pipeline: z.string().describe("The Pipeline's id, as list_pipelines gives it."),
        stages: z
          .array(stageSchema)
          .describe(
            "The Pipeline's Stages as they should be, all of them in order, in the shape list_pipelines gives them.",
          ),
      }),
      run: async ({ pipeline: pipelineId, stages }, { sessionId }) => {
        const pipeline = await this.library.find(pipelineId.trim());
        if (!pipeline) {
          return { text: `The library has no Pipeline "${pipelineId}".`, isError: true };
        }
        return drafted(() =>
          this.proposals.draft(sessionId, {
            kind: "pipeline",
            pipelineId: pipeline.id,
            from: pipeline.stages,
            to: stages,
          }),
        );
      },
    });
  }
}

/** Drafts with `draft`, answering the Agent that it is drafted, or with why it was refused. */
async function drafted(draft: () => Promise<unknown>): Promise<OfficeToolResult> {
  try {
    await draft();
    return { text: DRAFTED, isError: false };
  } catch (error) {
    if (error instanceof ProposalRefused) return { text: error.message, isError: true };
    throw error;
  }
}
