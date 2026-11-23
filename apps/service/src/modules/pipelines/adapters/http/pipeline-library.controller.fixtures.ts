import { randomUUID } from "node:crypto";
import { type PipelineEdit } from "@the-office/contracts";
import type { Stage } from "../../domain/stage.js";
import { agentStage, scriptStage } from "../../domain/stage.fixtures.js";

/** A Pipeline edit whose Stages are the domain's, so a test weighs them as the service does. */
type StagesEdit = Omit<PipelineEdit, "stages"> & { readonly stages: Stage[] };

/** Implement, then Tests, as a plain list. */
export function anEdit(fields: Partial<StagesEdit> = {}): StagesEdit {
  return {
    name: `Nightly ${randomUUID()}`,
    description: "For the nightly run.",
    stages: [agentStage(), scriptStage()],
    ...fields,
  };
}
