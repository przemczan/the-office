import type { Engine, EngineId } from "./engines.js";

/** A Stand-in Engine chosen for a cascade's engine: `standInId` runs what `engineId` would. */
export interface EngineStandInChoice {
  readonly engineId: EngineId;
  readonly standInId: EngineId;
}

/** What a stand-in must be besides having room, for the session it would run. */
export interface StandInNeeds {
  /**
   * Only stand-ins of the cascade's engine type count: the session must be carried, as a running
   * Stage's must.
   */
  readonly sameEngineType?: boolean;
  /**
   * Whether the engine has every capability the session needs (Office tools, a held answer); any
   * engine has when left out. The Engine module's `EngineSessions.capableOf` builds it.
   */
  readonly capable?: (engineId: EngineId) => boolean;
}

/**
 * The engine a session runs on, given the cascade's and the Stand-in Engines chosen for the run
 * (spec §5.4.6): the stand-in recorded for the cascade's engine while it is still listed and still
 * in `applyingList`, the stand-in list that applies, else the cascade's. Engines are compared by id
 * alone: the session's model comes from the person for the stand-in's type, which the caller
 * resolves. The usage estimates of a started Task and the Stage Threads both map through this
 * alone, so what is counted and where a session runs can't drift apart.
 */
export function engineThroughStandIns(
  cascade: EngineId,
  choices: readonly EngineStandInChoice[],
  engines: readonly Engine[],
  applyingList: readonly EngineId[],
): EngineId {
  const standInId = choices.find(({ engineId }) => engineId === cascade)?.standInId;
  return standInId !== undefined &&
    applyingList.includes(standInId) &&
    engines.some(({ id }) => id === standInId)
    ? standInId
    : cascade;
}

/**
 * The engine a session runs on, given the engine the cascade picked and `standIns`, the stand-in
 * list that applies (spec §5.4.6): the cascade's while it has room, else the first Stand-in Engine
 * in order that isn't the cascade's own, is listed, has every capability the session needs and has
 * room, whatever its engine type unless `sameEngineType`; else none. What "room" means is the
 * caller's: Start weighs the Window caps, a running Stage the windows not used up.
 */
export function engineToRunOn(
  cascade: EngineId,
  standIns: readonly EngineId[],
  engines: readonly Engine[],
  hasRoom: (engineId: EngineId) => boolean,
  { sameEngineType = false, capable = () => true }: StandInNeeds = {},
): EngineId | null {
  if (hasRoom(cascade)) return cascade;
  const cascadeType = engines.find(({ id }) => id === cascade)?.kind;
  const standIn = standIns.find((engineId) => {
    if (engineId === cascade) return false;
    const engine = engines.find(({ id }) => id === engineId);
    return (
      engine !== undefined &&
      (!sameEngineType || engine.kind === cascadeType) &&
      capable(engineId) &&
      hasRoom(engineId)
    );
  });
  return standIn ?? null;
}

/**
 * Why a Stand-in Engine list is refused (spec §5.4.6): an engine that isn't listed, or one named
 * twice. The Office's list and a Project's own are refused alike.
 */
export function standInListProblems(
  standIns: readonly EngineId[],
  engines: readonly Engine[],
): string[] {
  const problems: string[] = [];
  const seen = new Set<EngineId>();
  for (const engineId of standIns) {
    const engine = engines.find(({ id }) => id === engineId);
    if (engine === undefined) {
      problems.push("Pick each Stand-in Engine among the engines listed.");
    } else if (seen.has(engineId)) {
      problems.push(`"${engine.name}" is listed twice as a Stand-in Engine.`);
    }
    seen.add(engineId);
  }
  return problems;
}

/**
 * A Stand-in Engine list once `engineId` is removed (spec §5.4.5, "Removing an engine"): the
 * replacement takes its place, or, when the list already names the replacement or there is none,
 * the engine is just dropped.
 */
export function standInListWithout(
  standIns: readonly EngineId[],
  engineId: EngineId,
  replacementId: EngineId | null,
): EngineId[] {
  const takesPlace = replacementId !== null && !standIns.includes(replacementId);
  return standIns.flatMap((each) => {
    if (each !== engineId) return [each];
    return takesPlace ? [replacementId] : [];
  });
}
