import type { PipelineStage } from "../domain/usage-estimate.js";
import type { KnownPeople } from "../ports/known-people.js";

/**
 * `stages` with each Stage naming a duty given its holder's Role, as it would start now (spec
 * §2.3); one whose duty nobody holds keeps no Role, for Start to refuse naming the duty.
 */
export async function withDutiesHeld<Stage extends PipelineStage>(
  stages: readonly Stage[],
  people: KnownPeople,
): Promise<Stage[]> {
  const duties = new Set(
    stages.flatMap(({ role, duty }) => (role === undefined && duty !== undefined ? [duty] : [])),
  );
  const holders = duties.size === 0 ? new Map<string, string>() : await people.dutyHolders();
  return stages.map((stage) => {
    const holder = stage.role === undefined && stage.duty ? holders.get(stage.duty) : undefined;
    return holder === undefined ? stage : { ...stage, role: holder };
  });
}
