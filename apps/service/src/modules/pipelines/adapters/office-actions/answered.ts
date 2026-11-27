import { GateRefused } from "../../domain/gate-refused.js";
import {
  PipelineRemovalRefused,
  UnknownPipeline,
  UnknownProjectPipeline,
  UnknownStageTemplate,
} from "../../domain/pipeline-library-refusals.js";
import { RestartRefused } from "../../domain/restart-refused.js";
import { StagesEditRefused } from "../../domain/stages-edit-refused.js";

/** What an Office tool answers the Agent with. */
export interface Answered {
  readonly text: string;
  readonly isError: boolean;
}

/** Pipelines' refusals answer the Agent in words it can act on; anything else fails the call. */
export async function answered(run: () => Promise<string>): Promise<Answered> {
  try {
    return { text: await run(), isError: false };
  } catch (error) {
    if (
      error instanceof RestartRefused ||
      error instanceof StagesEditRefused ||
      error instanceof PipelineRemovalRefused ||
      error instanceof UnknownPipeline ||
      error instanceof UnknownProjectPipeline ||
      error instanceof UnknownStageTemplate ||
      error instanceof GateRefused
    ) {
      return { text: error.message, isError: true };
    }
    throw error;
  }
}
