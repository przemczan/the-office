/**
 * The domain entry of the module: the pure values and rules of its domain other modules' domain
 * layers use. It re-exports only its own `domain/`, so importing it loads no Nest module, no port
 * and no adapter (apps/service/docs/module-template.md). Everything here is in `index.ts` too.
 */
export {
  promptTemplate,
  type PromptTemplate,
  type PromptValues,
} from "./domain/prompt-template.js";
export { PromptTexts } from "./domain/prompt-texts.js";
export { flagField, renderedPart } from "./domain/rendered-part.js";
