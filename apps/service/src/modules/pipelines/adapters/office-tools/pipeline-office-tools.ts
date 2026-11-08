import { Injectable, type OnModuleInit } from "@nestjs/common";
import { stageSchema } from "@the-office/contracts";
import { z } from "zod";
import {
  LIST_PIPELINES_TOOL,
  PROPOSE_LIBRARY_PIPELINE_TOOL,
  ProposalRefused,
} from "../../../conversations/index.js";
import {
  OfficeToolRegistry,
  RUN_PROJECT_COMMAND_TOOL,
  type OfficeToolResult,
} from "../../../engine/index.js";
import { PipelineLibrary } from "../../application/pipeline-library.js";
import { StageBranchUpdate } from "../../application/stage-branch-update.js";
import { StageProjectCommands } from "../../application/stage-project-commands.js";
import {
  PROJECT_COMMAND_KEYS,
  type AgentCommand,
  type ProjectCommandKey,
} from "../../domain/agent-command.js";
import { UPDATE_BRANCH_TOOL } from "../../domain/stage-commit.js";
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
    private readonly branchUpdate: StageBranchUpdate,
    private readonly projectCommands: StageProjectCommands,
  ) {}

  onModuleInit(): void {
    this.registerListPipelines();
    this.registerProposePipeline();
    this.registerUpdateBranch();
    this.registerRunProjectCommand();
  }

  private registerRunProjectCommand(): void {
    this.registry.register({
      name: RUN_PROJECT_COMMAND_TOOL,
      description:
        "Runs one of the Project's commands by its key, or a command line you write, such as one test file, in the worktree's root, where the Project's commands run: in the Task's run environment when the Project has one, waiting for a free one. Give exactly one of command and commandLine. A command line runs only if your shell may run it. It waits until the command ends and answers with its exit code and the path of a file with its whole output, which you read with Read.",
      input: z.object({
        command: z
          .enum(PROJECT_COMMAND_KEYS)
          .optional()
          .describe("One of the Project's commands, by its key, run exactly as its settings say."),
        commandLine: z
          .string()
          .optional()
          .describe(
            "A command line for the platform's shell, run in the worktree's root, such as the test command with one test file.",
          ),
      }),
      run: ({ command, commandLine }, call) => {
        const asked = agentCommandOf(command, commandLine);
        return typeof asked === "string"
          ? Promise.resolve({ text: asked, isError: true })
          : this.projectCommands.inSession(asked, call);
      },
    });
  }

  private registerUpdateBranch(): void {
    this.registry.register({
      name: UPDATE_BRANCH_TOOL,
      description:
        "Asks The Office to bring the Task's branch up to date with the base branch: it commits your work so far and merges the base in. A conflict stays in the worktree for you to resolve by editing the files; The Office commits the merge when your Stage ends. It waits until the update and any install are done.",
      input: z.object({}),
      run: (_input, { sessionId }) => this.branchUpdate.inSession(sessionId),
    });
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

/** The command the Agent asked for, or why its ask names none. */
function agentCommandOf(
  key: ProjectCommandKey | undefined,
  commandLine: string | undefined,
): AgentCommand | string {
  const written = commandLine?.trim() ?? "";
  if (key !== undefined && written !== "") {
    return "Give either command or commandLine, not both.";
  }
  if (key !== undefined) return { key };
  if (written !== "") return { commandLine: written };
  return `Give the command to run: command, one of ${PROJECT_COMMAND_KEYS.join(", ")}, or commandLine.`;
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
