import { Injectable } from "@nestjs/common";

/** An open "Set up test targets" Task, by its id, title and state as Work has them. */
export interface TestTargetsSetUpTask {
  readonly id: string;
  readonly title: string;
  readonly state: string;
}

/** The Project's open "Set up test targets" Task; undefined when it has none. */
export type TestTargetsSetUpTaskLookup = (
  projectId: string,
) => Promise<TestTargetsSetUpTask | undefined>;

/**
 * Where the Project's open "Set up test targets" Task made before the chat is found, registered by
 * Work as it starts: Work reads Projects, so Projects can't ask it directly (the module template's
 * registry, as IssueTasks).
 */
@Injectable()
export class TestTargetsSetUpTasks {
  private lookup: TestTargetsSetUpTaskLookup | undefined;

  register(lookup: TestTargetsSetUpTaskLookup): void {
    this.lookup = lookup;
  }

  /** The Project's open set-up Task; undefined when it has none, or while nothing is registered. */
  async openOf(projectId: string): Promise<TestTargetsSetUpTask | undefined> {
    return this.lookup ? this.lookup(projectId) : undefined;
  }
}
