import type {
  PromptTemplateChange,
  PromptTemplateVersion,
} from "../domain/prompt-template-version.js";
import type { UserRef } from "../domain/user.js";
import { PromptTemplateRepository } from "./prompt-template-repository.js";

/**
 * Versions of the test's own: every test file shares the database, whose texts every Stage that
 * renders a template would read.
 */
export class PromptTemplateRepositoryForTests extends PromptTemplateRepository {
  private readonly versions: PromptTemplateVersion[] = [];

  async current(keys: readonly string[]): Promise<ReadonlyMap<string, PromptTemplateVersion>> {
    const newest = new Map<string, PromptTemplateVersion>();
    for (const version of this.versions) {
      if (keys.includes(version.key)) newest.set(version.key, version);
    }
    return newest;
  }

  async update(
    key: string,
    change: (current: PromptTemplateVersion | undefined) => PromptTemplateChange | undefined,
    savedAt: Date,
    savedBy: UserRef,
  ): Promise<PromptTemplateVersion | undefined> {
    const current = (await this.current([key])).get(key);
    const changed = change(current);
    if (!changed) return current;
    const saved = { key, ...changed, savedAt, savedBy };
    this.versions.push(saved);
    return saved;
  }
}
