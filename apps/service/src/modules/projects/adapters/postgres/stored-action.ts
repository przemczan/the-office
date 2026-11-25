import type { Action, ActionKind, ActionSetBy } from "../../domain/action.js";

/**
 * An Action's own values as its `settings` jsonb holds them, every kind's in one shape: a value a
 * row lacks reads as its default, so a later value needs no migration.
 */
export interface StoredActionSettings {
  readonly commandKey?: string;
  readonly commandsBefore?: readonly string[];
  readonly timeLimitMinutes?: number | null;
  readonly projectDeviceId?: string | null;
  readonly targetKey?: string;
  readonly file?: string;
  readonly inputs?: Readonly<Record<string, string>>;
}

export interface StoredAction {
  readonly key: string;
  readonly name: string;
  readonly kind: ActionKind;
  readonly settings: StoredActionSettings;
  readonly leavesTheWorkstation: boolean;
  readonly setBy: ActionSetBy;
}

export function storedAction(action: Action): StoredAction {
  const { key, name, kind, settings, leavesTheWorkstation, setBy } = action;
  return { key, name, kind, settings, leavesTheWorkstation, setBy };
}

export function actionOfStored({
  key,
  name,
  kind,
  settings,
  leavesTheWorkstation,
  setBy,
}: StoredAction): Action {
  const head = { key, name, leavesTheWorkstation, setBy };
  switch (kind) {
    case "project-command":
      return {
        ...head,
        kind,
        settings: {
          commandKey: settings.commandKey ?? "",
          commandsBefore: settings.commandsBefore ?? [],
          timeLimitMinutes: settings.timeLimitMinutes ?? null,
          projectDeviceId: settings.projectDeviceId ?? null,
        },
      };
    case "test-target":
      return { ...head, kind, settings: { targetKey: settings.targetKey ?? "" } };
    case "workflow":
      return {
        ...head,
        kind,
        settings: { file: settings.file ?? "", inputs: settings.inputs ?? {} },
      };
  }
}
