import { Injectable } from "@nestjs/common";
import type { EngineRemoval, MovedEngineReference } from "../domain/engine-removal.js";

/**
 * What a module keeps naming engines, as a removal moves it to the replacement
 * (`movedEngineModel`). Both go through the same functions, so what `movesOf` tells the user is
 * what `move` does.
 */
export interface EngineReferences {
  /** Each of its references the removal would move, moving nothing. */
  movesOf(removal: EngineRemoval): Promise<readonly MovedEngineReference[]>;
  /** Moves them; safe to run again, as a removal that failed part way is retried whole. */
  move(removal: EngineRemoval): Promise<void>;
}

/**
 * What moves the references to an engine being removed, filled by People (Role overrides) and
 * Projects (their levels) as they start: they read the engines from Engine, so Engine can't call
 * them directly (the module template's registry).
 */
@Injectable()
export class EngineReferenceMoves {
  private readonly references: EngineReferences[] = [];

  register(references: EngineReferences): void {
    this.references.push(references);
  }

  async movesOf(removal: EngineRemoval): Promise<MovedEngineReference[]> {
    const moves = await Promise.all(this.references.map((each) => each.movesOf(removal)));
    return moves.flat();
  }

  async moveEach(removal: EngineRemoval): Promise<void> {
    for (const references of this.references) await references.move(removal);
  }
}
