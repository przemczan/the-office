import {
  taskStateSchema,
  type ProjectRunEnvironment as ProjectRunEnvironmentResponse,
} from "@the-office/contracts";
import type { ProjectRunEnvironment } from "../../application/project-run-environments.js";

/** A Project's Run environment as the API shows it. */
export function toProjectRunEnvironmentResponse(
  runEnvironment: ProjectRunEnvironment,
): ProjectRunEnvironmentResponse {
  const { definition, setUpTask } = runEnvironment;
  return {
    runEnvironment: runEnvironment.runEnvironment,
    definition:
      definition.state === "not-valid"
        ? { state: "not-valid", problems: [...definition.problems] }
        : { state: definition.state },
    setUpProblems: [...runEnvironment.setUpProblems],
    setUpTask: setUpTask
      ? { id: setUpTask.id, title: setUpTask.title, state: taskStateSchema.parse(setUpTask.state) }
      : null,
  };
}
