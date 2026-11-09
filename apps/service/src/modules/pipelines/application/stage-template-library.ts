import { Injectable } from "@nestjs/common";
import type { StageTemplate } from "../domain/stage-template.js";
import { StageTemplateRepository } from "../ports/stage-template-repository.js";

/**
 * The library's Stage templates, as other modules read them. `StageTemplateLibraryEditor` changes
 * them.
 */
@Injectable()
export class StageTemplateLibrary {
  constructor(private readonly repository: StageTemplateRepository) {}

  async list(): Promise<readonly StageTemplate[]> {
    return this.repository.list();
  }

  async find(id: string): Promise<StageTemplate | undefined> {
    return this.repository.find(id);
  }
}
