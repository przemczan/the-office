import {
  ACTION_TIME_LIMIT_MINUTES,
  type ActionField,
  type ActionKind,
  type EditedAction,
} from "@the-office/contracts";

/** Each kind of Action by its name in the UI (spec §2.15, "Kinds"). */
export const ACTION_KIND_LABELS: Readonly<Record<ActionKind, string>> = {
  "project-command": "Project command",
  "test-target": "Test target",
  workflow: "Workflow",
};

/** Each value of an Action by its name in the UI, as the editor and a Proposal's card name it. */
export const ACTION_FIELD_LABELS: Readonly<Record<ActionField, string>> = {
  name: "Name",
  kind: "Kind",
  settings: "What it runs",
  leavesTheWorkstation: "Leaves the workstation",
};

/** The values every Action has, in the order a Proposal's card lists them. */
export const ACTION_FIELDS: readonly ActionField[] = [
  "name",
  "kind",
  "settings",
  "leavesTheWorkstation",
];

/** "60 minutes", or "1 minute". */
export function minutesWords(minutes: number): string {
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

/**
 * What an Action runs, in words: "build, after install → seed, time limit 30 minutes", the target's
 * key, or "release.yml with channel=beta". A test target is named by `targetName` when known.
 */
export function actionSettingsWords(
  action: EditedAction,
  targetName?: (key: string) => string | undefined,
): string {
  switch (action.kind) {
    case "project-command": {
      const { commandKey, commandsBefore, timeLimitMinutes } = action.settings;
      return [
        commandKey,
        ...(commandsBefore.length > 0 ? [`after ${commandsBefore.join(" → ")}`] : []),
        `time limit ${minutesWords(timeLimitMinutes ?? ACTION_TIME_LIMIT_MINUTES.default)}`,
      ].join(", ");
    }
    case "test-target":
      return targetName?.(action.settings.targetKey) ?? action.settings.targetKey;
    case "workflow": {
      const inputs = Object.entries(action.settings.inputs).map(
        ([name, value]) => `${name}=${value}`,
      );
      return inputs.length === 0
        ? action.settings.file
        : `${action.settings.file} with ${inputs.join(", ")}`;
    }
  }
}

/** One value of an Action as a Proposal's card shows it. */
export function actionFieldWords(action: EditedAction, field: ActionField): string {
  switch (field) {
    case "name":
      return action.name;
    case "kind":
      return ACTION_KIND_LABELS[action.kind];
    case "settings":
      return actionSettingsWords(action);
    case "leavesTheWorkstation":
      return action.leavesTheWorkstation ? "Yes" : "No";
  }
}

/** The hover words of the Leaves the workstation badge, naming the Project's base branch. */
export function leavesTheWorkstationWords(baseBranch: string): string {
  return `It pushes, publishes, deploys or releases. It runs from ${baseBranch} only, after a confirm step.`;
}
