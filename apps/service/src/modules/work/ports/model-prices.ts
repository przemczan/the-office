import type { EngineId } from "../../engine/index.js";
import type { StageTokens } from "../domain/usage-estimate.js";

/** The Model prices Settings › Engines sets, which the Engine module keeps; the composition root binds it. */
export abstract class ModelPrices {
  /** The dollars `tokens` on `model` cost on `engineId`; undefined when the model has no price. */
  abstract costOf(
    engineId: EngineId,
    model: string,
    tokens: StageTokens,
  ): Promise<number | undefined>;
}
