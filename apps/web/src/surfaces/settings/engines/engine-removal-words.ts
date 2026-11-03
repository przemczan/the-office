import type { EngineId, EngineModel, MovedEngineReference, Role } from "@the-office/contracts";
import { modelLabel } from "../../../shell/engine-words.ts";
import { personName } from "../../../shell/person-name.ts";

/**
 * The level a removal moves, in the glossary's terms: "The Office default", "The Project default
 * of Shop", "The Role override of Mia · Data Analyst", "The Role override of Mia · Data Analyst
 * in Shop".
 */
export function movedReferencePlace(
  { roleKey, project }: Pick<MovedEngineReference, "roleKey" | "project">,
  roles: readonly Role[] | undefined,
): string {
  if (roleKey === null) {
    return project === null ? "The Office default" : `The Project default of ${project.name}`;
  }
  const override = `The Role override of ${removalRoleName(roleKey, roles)}`;
  return project === null ? override : `${override} in ${project.name}`;
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
  officeDefault: EngineModel | null,
): EngineId | null {
  const others = engineIds.filter((id) => id !== removedId);
  const officeDefaultEngine = officeDefault?.engineId;
  if (officeDefaultEngine !== undefined && others.includes(officeDefaultEngine)) {
    return officeDefaultEngine;
  }
  return others[0] ?? null;
}
