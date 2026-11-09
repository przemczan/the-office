import type { StageTemplate } from "../domain/stage-template.js";

/** The library's Stage templates, stored by The Office; the built-ins are seeded once by migration. */
export abstract class StageTemplateRepository {
  /** In the library's order: the built-ins first, then the others as they were made. */
  abstract list(): Promise<readonly StageTemplate[]>;

  abstract find(id: string): Promise<StageTemplate | undefined>;

  abstract add(template: StageTemplate): Promise<void>;

  /** Replaces the stored template with this id. */
  abstract save(template: StageTemplate): Promise<void>;

  abstract remove(id: string): Promise<void>;
}
