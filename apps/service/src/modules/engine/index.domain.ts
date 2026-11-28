/**
 * The domain entry of the module: the pure values and rules of its domain other modules' domain
 * layers use. It re-exports only its own `domain/`, so importing it loads no Nest module, no port
 * and no adapter (apps/service/docs/module-template.md). Everything here is in `index.ts` too.
 */
export { canonicalJson, fingerprintOf } from "./domain/canonical-json.js";
export { RUN_PROJECT_COMMAND_TOOL } from "./domain/container-runtime-commands.js";
export type { EngineRemoval } from "./domain/engine-removal.js";
export {
  engineTypeOffersOf,
  modelEffortProblems,
  type EngineTypeOffers,
} from "./domain/engine-type-offers.js";
export {
  effortsTakenBy,
  ENGINE_TYPE_NAMES,
  hasUsageWindows,
  offeredModels,
  type Engine,
  type EngineId,
  type EngineKind,
  type EngineModel,
} from "./domain/engines.js";
export {
  READ_ONLY_SHELL_RULE,
  WRITE_RUN_ENVIRONMENT_DEFINITION_TOOL,
} from "./domain/office-rules.js";
export {
  engineToRunOn,
  standInListProblems,
  standInListWithout,
} from "./domain/stand-in-engines.js";
export { usageWindowWords } from "./domain/usage-window-words.js";
