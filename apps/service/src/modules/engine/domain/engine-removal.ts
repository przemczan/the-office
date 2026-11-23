import { EngineSettingsRefused, ENGINES_CHANGED_MEANWHILE } from "./engine-settings-refused.js";
import type { Engine, EngineId, EngineModel } from "./engines.js";

/**
 * An engine being removed and the one that takes over everything naming it, or none when it is
 * the only engine (spec §5.4).
 */
export interface EngineRemoval {
  readonly engineId: EngineId;
  readonly replacement: Engine | null;
}

/**
 * A level naming the engine being removed: where it stands and where the removal puts it. Which
 * level it is follows from what it belongs to: a Role and a Project for a Project's Role override,
 * a Project alone for its Project default, a Role alone for its Role override, neither for the
 * Office default; a Task or an Initiative (`work`) for its engine; `standInList` for a Stand-in
 * Engine list, the Office's with no Project, a Project's own with it.
 */
export interface MovedEngineReference {
  readonly roleKey: string | null;
  readonly project: { readonly id: string; readonly name: string } | null;
  /** The Task or the Initiative whose engine it is, with its Project; null for every other level. */
  readonly work: MovedWork | null;
  /**
   * Set on a Stand-in Engine list's move: the removed engine's place in it taken by the
   * replacement, or the engine dropped (`standInListWithout`); left out for every other level.
   */
  readonly standInList?: true;
  readonly from: EngineModel;
  readonly to: EngineModel | null;
}

/**
 * A Task or an Initiative naming the removed engine, Done and Dropped ones too, with its state as
 * Work names it, so the Remove engine window marks those.
 */
export type MovedWork =
  | (MovedWorkRecord & { readonly kind: "task"; readonly state: MovedTaskState })
  | (MovedWorkRecord & { readonly kind: "initiative"; readonly state: MovedInitiativeState });

interface MovedWorkRecord {
  readonly id: string;
  readonly name: string;
}

/** A Task's state, as Work names it. */
export type MovedTaskState =
  | "shaping"
  | "backlog"
  | "planning"
  | "ready"
  | "in-progress"
  | "waiting-on-you"
  | "paused"
  | "done"
  | "dropped";

/** An Initiative's state, as Work names it. */
export type MovedInitiativeState = "shaping" | "active" | "done" | "dropped";

/**
 * What `removal` does to an engine override, a Task's or an Initiative's (`work`), when it names
 * the removed engine: from it to the replacement, or none. An override names an engine, not a
 * model, so each side is on its engine's default model, as a Stand-in Engine list's move is.
 */
export function movedEngineOverride(
  engineOverride: EngineId,
  removal: EngineRemoval,
  removed: Engine | undefined,
  where: Pick<MovedEngineReference, "project" | "work">,
): MovedEngineReference[] {
  if (engineOverride !== removal.engineId) return [];
  const { replacement } = removal;
  return [
    {
      roleKey: null,
      ...where,
      from: { engineId: removal.engineId, model: removed?.defaultModel ?? "" },
      to: replacement && { engineId: replacement.id, model: replacement.defaultModel },
    },
  ];
}

/** Where an engine id stands once the removal is done: the replacement's, or none, for the removed engine. */
export function movedEngineId(engineId: EngineId, removal: EngineRemoval): EngineId | null {
  return engineId === removal.engineId ? (removal.replacement?.id ?? null) : engineId;
}

/**
 * What `removal` does to a Stand-in Engine list, the Office's (`project` null) or a Project's own,
 * used or not, when it names the removed engine: from the removed engine to the replacement, or to
 * none when the engine is just dropped, with no replacement or one the list already names
 * (`standInListWithout`). A list names engines, not models, so each side is on its engine's default
 * model, as a Project default's move is.
 */
export function movedStandInList(
  standIns: readonly EngineId[],
  removal: EngineRemoval,
  removed: Engine | undefined,
  project: MovedEngineReference["project"],
): MovedEngineReference[] {
  if (!standIns.includes(removal.engineId)) return [];
  const replacement =
    removal.replacement !== null && !standIns.includes(removal.replacement.id)
      ? removal.replacement
      : null;
  return [
    {
      roleKey: null,
      project,
      work: null,
      standInList: true,
      from: { engineId: removal.engineId, model: removed?.defaultModel ?? "" },
      to: replacement && { engineId: replacement.id, model: replacement.defaultModel },
    },
  ];
}

/**
 * The removal of the engine `engineId` with `replacementId` taking over, among the engines listed;
 * with no replacement only the only engine goes. Refused in words when either isn't listed, or
 * when no replacement is given while other engines are.
 */
export function engineRemovalAmong(
  engines: readonly Engine[],
  engineId: EngineId,
  replacementId: EngineId | null,
): EngineRemoval {
  const removed = engines.find(({ id }) => id === engineId);
  if (removed === undefined) {
    throw new EngineSettingsRefused([ENGINES_CHANGED_MEANWHILE]);
  }
  if (replacementId === null && engines.length === 1) return { engineId, replacement: null };
  const replacement = engines.find(({ id }) => id === replacementId && id !== engineId);
  if (replacement === undefined) {
    throw new EngineSettingsRefused([
      `Pick the engine that takes over from "${removed.name}" among the other engines.`,
    ]);
  }
  return { engineId, replacement };
}
