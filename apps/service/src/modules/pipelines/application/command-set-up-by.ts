import type { KnownPeople } from "../ports/known-people.js";

/** The duty of whoever sets up a Project's commands (spec §2.3, "Script"). */
const ONBOARDS_PROJECTS = "onboards-projects";

/**
 * Whom a Script Stage's or condition's missing command tells to consult: the holder of Onboards and
 * repairs Projects, by name; undefined while nobody holds it.
 */
export async function setUpByOf(
  people: KnownPeople,
): Promise<{ readonly name: string } | undefined> {
  const roleKey = await people.holderOf(ONBOARDS_PROJECTS);
  if (!roleKey) return undefined;
  const person = await people.find(roleKey);
  return person ? { name: person.card.name } : undefined;
}
