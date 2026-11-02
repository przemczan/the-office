import type { EngineModel } from "../../engine/index.js";
import type { StageTokens } from "../domain/usage-estimate.js";

/** The Model prices Settings › Engines sets, which the Engine module keeps; the composition root binds it. */
export abstract class ModelPrices {
  /** The dollars `tokens` cost on an engine's model; undefined when the model has no price. */
  abstract costOf(spentOn: EngineModel, tokens: StageTokens): Promise<number | undefined>;
}
