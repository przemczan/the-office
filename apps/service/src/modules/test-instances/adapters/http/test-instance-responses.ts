import type { TestInstance as TestInstanceResponse } from "@the-office/contracts";
import type { TestInstanceOnBranch } from "../../application/test-instances.js";

export function instanceResponse(instance: TestInstanceOnBranch): TestInstanceResponse {
  return {
    id: instance.id,
    initiativeId: instance.initiativeId ?? null,
    projectId: instance.projectId,
    branch: instance.branch,
    targetKey: instance.targetKey,
    targetName: instance.targetName,
    kind: instance.kind,
    state: instance.state,
    commit: instance.commit ?? null,
    port: instance.port ?? null,
    failedReason: instance.failedReason ?? null,
    launchedBy: instance.launchedBy,
    launchedAt: instance.launchedAt.toISOString(),
    runningAt: instance.runningAt?.toISOString() ?? null,
    endedAt: instance.endedAt?.toISOString() ?? null,
    files: instance.files.map(({ name, size }) => ({ name, size })),
    filesRemoved: instance.filesRemovedAt !== undefined,
    runAs: instance.runAs === undefined ? null : { ...instance.runAs },
    device: instance.device === undefined ? null : { ...instance.device },
    buildInstanceId: instance.buildInstanceId ?? null,
    builtFor: instance.builtFor === undefined ? null : { ...instance.builtFor },
  };
}
