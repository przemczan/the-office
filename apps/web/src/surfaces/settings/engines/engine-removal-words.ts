import type { Engine, EngineId, MovedEngineReference, OfficeDefault } from "@the-office/contracts";
import { ENGINE_KIND_LABELS } from "../../../shell/engine-words.ts";

/**
 * The level a removal moves, in the glossary's terms: "The Office default", "The Project default
 * of Shop", "The engine override of the Task “Export Stats as CSV”", "The engine override of the
 * Initiative “Usage reports”", "The Office's Stand-in Engine list", "The Stand-in Engine list of
 * Shop". A person's model and effort name engine types, not engines, so no level of a person's own
 * is among them.
 */
export function movedReferencePlace({
  project,
  work,
  standInList,
}: Pick<MovedEngineReference, "project" | "work" | "standInList">): string {
  if (standInList) {
    return project === null
      ? "The Office's Stand-in Engine list"
      : `The Stand-in Engine list of ${project.name}`;
  }
  if (work !== null) {
    return `The engine override of the ${work.kind === "task" ? "Task" : "Initiative"} “${work.name}”`;
  }
  return project === null ? "The Office default" : `The Project default of ${project.name}`;
}

/**
 * The state the window marks a Task's or an Initiative's row with: Done or Dropped, which read and
 * look the same on both; none for an open one, or a level of no Task or Initiative.
 */
export function endedStateOf({
  work,
}: Pick<MovedEngineReference, "work">): "done" | "dropped" | null {
  return work?.state === "done" || work?.state === "dropped" ? work.state : null;
}

/**
 * "Second account → Claude Code", or "Claude Code → none" for the only engine, or for a Stand-in
 * Engine list already naming the replacement: every level names an engine, not a model.
 */
export function movedReferenceChange(
  { from, to }: Pick<MovedEngineReference, "from" | "to">,
  engineName: (engineId: EngineId) => string,
): string {
  return `${engineName(from)} → ${to === null ? "none" : engineName(to)}`;
}

/**
 * The replacement offered first: the first other engine of the removed one's type, else the
 * Office default's engine, else the first other engine listed; none when it is the only engine.
 */
export function suggestedReplacement(
  engines: readonly Pick<Engine, "id" | "kind">[],
  removedId: EngineId,
  officeDefault: Pick<OfficeDefault, "engineId"> | null,
): EngineId | null {
  const removed = engines.find(({ id }) => id === removedId);
  const others = engines.filter(({ id }) => id !== removedId);
  const sameType = others.find(({ kind }) => kind === removed?.kind);
  const officeDefaultEngine = others.find(({ id }) => id === officeDefault?.engineId);
  return (sameType ?? officeDefaultEngine ?? others[0])?.id ?? null;
}

/**
 * What changes beyond the moves themselves (spec §5.4.5, "Removing an engine"): a replacement of
 * another type gives the defaults it takes over its type, and the last engine of its type leaves
 * people's and Projects' settings for the type unused until one of that type is listed again.
 */
export function removalTypeNotes(
  engines: readonly Pick<Engine, "id" | "kind" | "name">[],
  removedId: EngineId,
  replacementId: EngineId | null,
): string[] {
  const removed = engines.find(({ id }) => id === removedId);
  if (removed === undefined) return [];
  const replacement = engines.find(({ id }) => id === replacementId);
  const typeName = ENGINE_KIND_LABELS[removed.kind];
  const notes: string[] = [];
  if (replacement !== undefined && replacement.kind !== removed.kind) {
    notes.push(
      `${replacement.name} is of another engine type, ${ENGINE_KIND_LABELS[replacement.kind]}: the Office default and the Project defaults it takes over take its type with it, and each person works there with their model and effort for it.`,
    );
  }
  if (!engines.some(({ id, kind }) => id !== removedId && kind === removed.kind)) {
    notes.push(
      `${removed.name} is the last ${typeName} engine: people's and Projects' settings for ${typeName} are kept, unused until a ${typeName} engine is listed again.`,
    );
  }
  return notes;
}
