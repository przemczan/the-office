import type { Role, TaskStage } from "@the-office/contracts";
import type { ReactNode } from "react";
import { NamedTag, PersonTag } from "../../shell/person-tag.tsx";
import { stageWorkerWords, workingRoleKey } from "./stage-rail-words.ts";

/** Who works a Stage, as the rail and the Stage history draw them. */
export function StageWorker({
  taskStage,
  roles,
}: {
  readonly taskStage: TaskStage;
  readonly roles: readonly Role[] | undefined;
}): ReactNode {
  const { stage } = taskStage;
  const words = stageWorkerWords(taskStage, roles);
  if (stage.kind === "gate") return <NamedTag name={words} />;
  if (stage.kind === "script") {
    return (
      <span className="person-tag">
        <span className="person-tag-command" aria-hidden="true">
          $
        </span>
        <span className="person-tag-name" title={words}>
          {words}
        </span>
      </span>
    );
  }
  const roleKey = workingRoleKey(taskStage);
  const role = roles?.find(({ key }) => key === roleKey);
  return role ? <PersonTag roleKey={role.key} name={role.card.name} /> : words;
}
