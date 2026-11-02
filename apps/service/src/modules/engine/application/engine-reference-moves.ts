import { Injectable } from "@nestjs/common";
import type { EngineRemoval } from "../domain/engine-removal.js";

/** Moves what a module keeps naming the removed engine to the replacement (`movedEngineModel`). */
export type EngineReferenceMove = (removal: EngineRemoval) => Promise<void>;

/**
 * What moves the references to an engine being removed, filled by People (Role overrides) and
 * Projects (their levels) as they start: they read the engines from Engine, so Engine can't call
 * them directly (the module template's registry). Each move must be safe to run again, as a
 * removal that failed part way is retried whole.
 */
@Injectable()
export class EngineReferenceMoves {
  private readonly moves: EngineReferenceMove[] = [];

  register(move: EngineReferenceMove): void {
    this.moves.push(move);
  }

  async moveEach(removal: EngineRemoval): Promise<void> {
    for (const move of this.moves) await move(removal);
  }
}
