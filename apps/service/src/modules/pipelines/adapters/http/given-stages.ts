import { withGivenLimits, type GivenStage } from "../../domain/flow.js";
import type { Stage } from "../../domain/stage.js";

/**
 * A request's edit with its Stages as the domain takes them: each route given without a limit
 * takes the default for where it leads (spec §2.3, "A route's limit"), as the contract lets a
 * request leave it out.
 */
export function withStagesGiven<Edit extends { readonly stages: readonly GivenStage[] }>(
  edit: Edit,
): Omit<Edit, "stages"> & { readonly stages: Stage[] } {
  return { ...edit, stages: withGivenLimits(edit.stages) };
}

/** One Stage given alone, as a Stage template's: its routes' limits set as `withStagesGiven` sets them. */
export function givenStage(stage: GivenStage): Stage {
  const [given] = withGivenLimits([stage]);
  return given ?? (stage as Stage);
}
