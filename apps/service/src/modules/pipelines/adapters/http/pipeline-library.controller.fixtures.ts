import { randomUUID } from "node:crypto";
import { type PipelineEdit } from "@the-office/contracts";
import { agentStage, scriptStage } from "../../domain/stage.fixtures.js";

export function anEdit(fields: Partial<PipelineEdit> = {}): PipelineEdit {
  return {
    name: `Nightly ${randomUUID()}`,
    description: "For the nightly run.",
    stages: [agentStage(), scriptStage({ onFailure: { goBackTo: "implement", rounds: 2 } })],
    ...fields,
  };
}
