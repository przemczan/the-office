import { ProjectNotFound, ProjectRefused } from "../../../projects/index.js";
import { ActionRunNotFound, ActionRunRefused } from "../../domain/action-run-refused.js";

/** Projects' refusals in the Actions' own: ProjectRefused's reasons, ProjectNotFound's Project. */
export async function translated<Answer>(asked: () => Promise<Answer>): Promise<Answer> {
  try {
    return await asked();
  } catch (error) {
    if (error instanceof ProjectRefused) throw new ActionRunRefused(error.reasons);
    if (error instanceof ProjectNotFound) throw ActionRunNotFound.project(error.projectId);
    throw error;
  }
}
