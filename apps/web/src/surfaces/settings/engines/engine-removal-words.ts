import type {
  EngineId,
  EngineModel,
  MovedEngineReference,
  OfficeDefault,
  Role,
} from "@the-office/contracts";
import { modelLabel } from "../../../shell/engine-words.ts";
import { personName } from "../../../shell/person-name.ts";

/**
 * The level a removal moves, in the glossary's terms: "The Office default", "The Project default
 * of Shop", "The Role override of Mia · Data Analyst in Shop", "The engine of the Task “Export
 * Stats as CSV”", "The engine of the Initiative “Usage reports”". A person's model and effort name
 * engine types, not engines, so no level of a person's own is among them.
 */
export function movedReferencePlace(
  { roleKey, project, work }: Pick<MovedEngineReference, "roleKey" | "project" | "work">,
  roles: readonly Role[] | undefined,
): string {
  if (work !== null) {
    return `The engine of the ${work.kind === "task" ? "Task" : "Initiative"} “${work.name}”`;
  }
  if (project === null) return "The Office default";
  return roleKey === null
    ? `The Project default of ${project.name}`
    : `The Role override of ${removalRoleName(roleKey, roles)} in ${project.name}`;
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

/** "Haiku 5.5 on Second account → Haiku 5.5 on Claude Code", or "… → none" for the only engine. */
export function movedReferenceChange(
  { from, to }: Pick<MovedEngineReference, "from" | "to">,
  engineName: (engineId: EngineId) => string,
): string {
  const where = ({ engineId, model }: EngineModel): string =>
    `${modelLabel(model)} on ${engineName(engineId)}`;
  return `${where(from)} → ${to === null ? "none" : where(to)}`;
}

/**
 * The person in the Role, marked when they were let go (a removal moves their override too); the
 * key only when the Role isn't read.
 */
function removalRoleName(roleKey: string, roles: readonly Role[] | undefined): string {
  const role = roles?.find(({ key }) => key === roleKey);
  if (role === undefined) return roleKey;
  return role.letGoAt === null ? personName(role) : `${personName(role)} (let go)`;
}

/**
 * The replacement offered first: the Office default's engine unless it is the one going, else the
 * first other engine listed; none when it is the only engine.
 */
export function suggestedReplacement(
  engineIds: readonly EngineId[],
  removedId: EngineId,
  officeDefault: Pick<OfficeDefault, "engineId"> | null,
): EngineId | null {
  const others = engineIds.filter((id) => id !== removedId);
  const officeDefaultEngine = officeDefault?.engineId;
  if (officeDefaultEngine !== undefined && others.includes(officeDefaultEngine)) {
    return officeDefaultEngine;
  }
  return others[0] ?? null;
}
