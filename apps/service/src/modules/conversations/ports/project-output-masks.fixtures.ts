import { NO_MASK, ProjectOutputMasks, type TextMask } from "./project-output-masks.js";

/** Each Project's mask as a test sets it; a Project it doesn't name masks nothing. */
export class ProjectOutputMasksForTests extends ProjectOutputMasks {
  readonly masks = new Map<string, TextMask>();

  outputMaskOf(projectId: string): Promise<TextMask> {
    return Promise.resolve(this.masks.get(projectId) ?? NO_MASK);
  }
}
