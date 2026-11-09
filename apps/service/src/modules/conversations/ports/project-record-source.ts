/**
 * The Projects' short records as an Agent reads them, which the Projects module keeps; the
 * composition root binds it.
 */
export abstract class ProjectRecordSource {
  /** The Project's record; undefined when The Office has no such Project. */
  abstract of(projectId: string): Promise<string | undefined>;
}
