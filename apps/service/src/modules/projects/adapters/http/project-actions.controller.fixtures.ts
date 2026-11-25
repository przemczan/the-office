import type { EditedAction } from "@the-office/contracts";

/** A Project command Action running the Project's build, Install first. */
export function aProjectCommandAction(fields: Partial<EditedAction> = {}): EditedAction {
  return {
    key: "build-web",
    name: "Build web",
    kind: "project-command",
    settings: {
      commandKey: "build",
      commandsBefore: ["install"],
      timeLimitMinutes: 30,
      projectDeviceId: null,
    },
    leavesTheWorkstation: false,
    ...fields,
  } as EditedAction;
}

/** A Workflow Action starting release.yml with its channel fixed. */
export function aWorkflowAction(fields: Partial<EditedAction> = {}): EditedAction {
  return {
    key: "release",
    name: "Release",
    kind: "workflow",
    settings: { file: "release.yml", inputs: { channel: "stable" } },
    leavesTheWorkstation: false,
    ...fields,
  } as EditedAction;
}
