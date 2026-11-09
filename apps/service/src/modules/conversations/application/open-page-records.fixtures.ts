import { PersonRecords } from "../../people/index.js";
import { ProjectRecordSource } from "../ports/project-record-source.js";

/**
 * Providers of the people's and Projects' short records an Open page gives, for a test assembling
 * `MentionedRecords` by hand: each reads from its map, by Role key and by Project id.
 */
export function openPageRecordProviders(
  people: ReadonlyMap<string, string> = new Map(),
  projects: ReadonlyMap<string, string> = new Map(),
) {
  return [
    {
      provide: PersonRecords,
      useValue: {
        of: (roleKey: string) => Promise.resolve(people.get(roleKey)),
      } satisfies Pick<PersonRecords, "of">,
    },
    {
      provide: ProjectRecordSource,
      useValue: {
        of: (projectId: string) => Promise.resolve(projects.get(projectId)),
      } satisfies ProjectRecordSource,
    },
  ];
}
