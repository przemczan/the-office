import { expect } from "vitest";
import { randomUUID } from "node:crypto";
import { stagesEditRefusalSchema } from "@the-office/contracts";
import { agentStage } from "../../domain/stage.fixtures.js";
import type { Stage } from "../../domain/stage.js";

/** A Stage under a name of its own, which no other template has. */
export function aStage(fields: Partial<Stage> = {}): Stage {
  return { ...agentStage({ name: `Draft ${randomUUID()}` }), ...fields } as Stage;
}

export async function refusal(response: Response) {
  expect(response.status).toBe(422);
  return stagesEditRefusalSchema.parse(await response.json()).problems;
}
