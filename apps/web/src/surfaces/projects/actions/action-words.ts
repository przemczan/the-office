import {
  ACTION_NAME_MAX_LENGTH,
  type Action,
  type ActionKind,
  type EditedAction,
  type ManualWorkflowList,
  type Project,
  type ProjectDevice,
  type TestTarget,
} from "@the-office/contracts";
import { ACTION_FIELDS } from "../../../shell/action-words.ts";
import { notAProjectDeviceWords } from "../../../shell/devices/project-device-words.ts";
import {
  notACommandWords,
  runnableCommandsOf,
  setterName,
  unknownCommandKeys,
} from "../test-target-words.ts";

/** An Action as its editor holds it: every kind's settings, so changing kind keeps what was typed. */
export interface ActionDraft {
  readonly key: string;
  readonly name: string;
  readonly kind: ActionKind;
  readonly commandKey: string;
  readonly commandsBefore: readonly string[];
  /** Its own time limit in minutes; null for the default. */
  readonly timeLimitMinutes: number | null;
  /** The Project device its run holds, by its id; null for none. */
  readonly projectDeviceId: string | null;
  readonly targetKey: string;
  /** The Workflow's file, by the id the workflows list gives it. */
  readonly file: string;
  /** The inputs the user entered or the Action had, by name. */
  readonly inputs: Readonly<Record<string, string>>;
  readonly leavesTheWorkstation: boolean;
}

/** A new Action's editor: a Project command, nothing picked yet. */
export const NEW_ACTION_DRAFT: ActionDraft = {
  key: "",
  name: "",
  kind: "project-command",
  commandKey: "",
  commandsBefore: [],
  timeLimitMinutes: null,
  projectDeviceId: null,
  targetKey: "",
  file: "",
  inputs: {},
  leavesTheWorkstation: false,
};

export function actionDraftOf(action: Action): ActionDraft {
  const draft = {
    ...NEW_ACTION_DRAFT,
    key: action.key,
    name: action.name,
    kind: action.kind,
    leavesTheWorkstation: action.leavesTheWorkstation,
  };
  switch (action.kind) {
    case "project-command":
      return {
        ...draft,
        commandKey: action.settings.commandKey,
        commandsBefore: action.settings.commandsBefore,
        timeLimitMinutes: action.settings.timeLimitMinutes,
        projectDeviceId: action.settings.projectDeviceId,
      };
    case "test-target":
      return { ...draft, targetKey: action.settings.targetKey };
    case "workflow":
      return { ...draft, file: action.settings.file, inputs: action.settings.inputs };
  }
}

/**
 * The draft of another kind: an Action is marked Leaves the workstation as it becomes a Workflow
 * (spec §2.15, "Leaves the workstation"); the user may clear it after.
 */
export function withKind(draft: ActionDraft, kind: ActionKind): ActionDraft {
  if (kind === draft.kind) return draft;
  return {
    ...draft,
    kind,
    leavesTheWorkstation: kind === "workflow" ? true : draft.leavesTheWorkstation,
  };
}

/**
 * The Action the draft describes, or what it lacks. A Workflow's inputs are `inputs`, as its file
 * declares them; the service checks the rest (the key, the names it gives, the Project's variables).
 */
export function editedActionOf(
  draft: ActionDraft,
  inputs: Readonly<Record<string, string>>,
): { readonly action: EditedAction } | { readonly problems: readonly string[] } {
  const problems: string[] = [];
  const name = draft.name.trim();
  if (draft.key.trim() === "") problems.push("Give the Action a key.");
  if (name === "") problems.push("Give the Action a name.");
  if (name.length > ACTION_NAME_MAX_LENGTH) {
    problems.push(`Its name is at most ${ACTION_NAME_MAX_LENGTH} characters.`);
  }
  if (draft.kind === "project-command" && draft.commandKey === "") {
    problems.push("Pick the command it runs.");
  }
  if (draft.kind === "test-target" && draft.targetKey === "") {
    problems.push("Pick the test target it launches.");
  }
  if (draft.kind === "workflow" && draft.file === "") problems.push("Pick the workflow it starts.");
  if (problems.length > 0) return { problems };
  const head = {
    key: draft.key.trim(),
    name,
    leavesTheWorkstation: draft.leavesTheWorkstation,
  };
  switch (draft.kind) {
    case "project-command":
      return {
        action: {
          ...head,
          kind: "project-command",
          settings: {
            commandKey: draft.commandKey,
            commandsBefore: [...draft.commandsBefore],
            timeLimitMinutes: draft.timeLimitMinutes,
            projectDeviceId: draft.projectDeviceId,
          },
        },
      };
    case "test-target":
      return { action: { ...head, kind: "test-target", settings: { targetKey: draft.targetKey } } };
    case "workflow":
      return {
        action: {
          ...head,
          kind: "workflow",
          settings: { file: draft.file, inputs: { ...inputs } },
        },
      };
  }
}

/** An Action as the whole list sends it back unchanged. */
export function keptAction(action: Action): EditedAction {
  const { setBy: _setBy, ...fields } = action;
  return fields;
}

/**
 * The Project's whole list with `edited` in place of the Action of its key, or added last; or
 * without the Action of `removedKey`.
 */
export function actionsWith(
  actions: readonly Action[],
  change: { readonly edited: EditedAction } | { readonly removedKey: string },
): EditedAction[] {
  if ("removedKey" in change) {
    return actions.filter(({ key }) => key !== change.removedKey).map(keptAction);
  }
  const { edited } = change;
  const kept = actions.map((action) => (action.key === edited.key ? edited : keptAction(action)));
  return actions.some(({ key }) => key === edited.key) ? kept : [...kept, edited];
}

/**
 * Who set the Action's values last, as its row marks it: "Set by you", "Set by Nina", or "Set by
 * you and Nina"; undefined when no value records anyone.
 */
export function actionSetByWords(
  action: Action,
  signedInUserId: string | undefined,
): string | undefined {
  const names = [
    ...new Set(
      ACTION_FIELDS.flatMap((field) => {
        const setter = action.setBy[field];
        return setter ? [setterName(setter, signedInUserId)] : [];
      }),
    ),
  ];
  if (names.length === 0) return undefined;
  names.sort((one, other) => Number(other === "you") - Number(one === "you"));
  const last = names.pop();
  return `Set by ${names.length === 0 ? last : `${names.join(", ")} and ${last}`}`;
}

/** Under a Project command Action naming a device while Run environment isn't On; Run is disabled. */
export const NEEDS_RUN_ENVIRONMENT_TO_RUN = "Needs Run environment On to run.";

/** Whether the Action's run holds a Project device, which needs Run environment On. */
export function needsRunEnvironmentToRun(
  action: Action,
  runEnvironment: Project["runEnvironment"],
): boolean {
  return (
    action.kind === "project-command" &&
    action.settings.projectDeviceId !== null &&
    runEnvironment !== "on"
  );
}

/** What the Project has now, which an Action's settings name; a list still being read is undefined. */
export interface ActionContext {
  readonly project: Pick<Project, "name" | "baseBranch" | "installCommand" | "commands">;
  readonly targets: readonly TestTarget[] | undefined;
  readonly devices: readonly ProjectDevice[] | undefined;
  /** The workflows on the base branch that can be started by hand, as read. */
  readonly workflows: ManualWorkflowList | undefined;
}

/**
 * The warnings on an Action whose settings name something the Project no longer has: a command, a
 * device, a test target, or a Workflow its base branch doesn't let start by hand. Nothing is said
 * about a list not read, or read with a problem.
 */
export function actionWarnings(
  action: Action,
  { project, targets, devices, workflows }: ActionContext,
): string[] {
  switch (action.kind) {
    case "project-command": {
      const { commandKey, commandsBefore, projectDeviceId } = action.settings;
      const keys = [...new Set([commandKey, ...commandsBefore])];
      const deviceGone =
        projectDeviceId !== null &&
        devices !== undefined &&
        !devices.some(({ id }) => id === projectDeviceId);
      return [
        ...unknownCommandKeys(keys, runnableCommandsOf(project)).map(notACommandWords),
        ...(deviceGone ? [notAProjectDeviceWords(undefined, project.name)] : []),
      ];
    }
    case "test-target": {
      const { targetKey } = action.settings;
      if (!targets || targets.some(({ key }) => key === targetKey)) return [];
      return [`${targetKey} isn't one of ${project.name}'s test targets anymore.`];
    }
    case "workflow": {
      const { file } = action.settings;
      if (!workflows || workflows.problem !== null) return [];
      if (workflows.workflows.some(({ id }) => id === file)) return [];
      return [`${file} doesn't declare a start by hand on ${project.baseBranch} anymore.`];
    }
  }
}

/** In the editor, on an input the Action fixed that its file no longer declares. */
export function undeclaredInputWords(input: string, file: string, baseBranch: string): string {
  return `${input} isn't an input ${file} declares on ${baseBranch} anymore; saving leaves it out.`;
}
