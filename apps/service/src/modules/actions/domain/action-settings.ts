/** Settings › Office limits' Actions card (spec §2.15, "Actions at once"). */
export interface ActionSettings {
  /** How many Project command runs may be running together across The Office. */
  readonly actionsAtOnce: number;
}

export const ACTIONS_AT_ONCE_BOUNDS = { min: 1, max: 6 } as const;

export const DEFAULT_ACTION_SETTINGS: ActionSettings = { actionsAtOnce: 2 };

/** Every problem with the settings, in the card's words. */
export function settingsProblems(settings: ActionSettings): string[] {
  const { actionsAtOnce } = settings;
  return Number.isInteger(actionsAtOnce) &&
    actionsAtOnce >= ACTIONS_AT_ONCE_BOUNDS.min &&
    actionsAtOnce <= ACTIONS_AT_ONCE_BOUNDS.max
    ? []
    : [
        `Actions at once is a whole number from ${ACTIONS_AT_ONCE_BOUNDS.min} to ${ACTIONS_AT_ONCE_BOUNDS.max}.`,
      ];
}
