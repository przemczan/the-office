import type {
  PromptTemplateChange,
  PromptTemplateVersion,
} from "../domain/prompt-template-version.js";
import type { UserRef } from "../domain/user.js";

/** Every version of each template's text, kept with who saved it and when. */
export abstract class PromptTemplateRepository {
  /** The newest version of each of the templates `keys` that has one, by key. */
  abstract current(keys: readonly string[]): Promise<ReadonlyMap<string, PromptTemplateVersion>>;

  /**
   * Saves the version `change` makes of the template's newest one, with no other save of it between
   * the two, as saved by the user `savedBy`, and answers the newest version after it; `change`
   * returning undefined saves nothing.
   */
  abstract update(
    key: string,
    change: (current: PromptTemplateVersion | undefined) => PromptTemplateChange | undefined,
    savedAt: Date,
    savedBy: UserRef,
  ): Promise<PromptTemplateVersion | undefined>;
}
