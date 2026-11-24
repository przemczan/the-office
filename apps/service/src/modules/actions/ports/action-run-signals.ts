/**
 * What other modules announce that stops or removes runs: Work's fire alarm sounded ASAP, a
 * Project's Actions switched off, Actions removed from a Project. Bound to an adapter over their
 * domain events.
 */
export abstract class ActionRunSignals {
  abstract onAlarmSoundedAsap(listener: () => void): void;

  abstract onActionsSwitchedOff(listener: (projectId: string) => void): void;

  abstract onActionsRemoved(
    listener: (projectId: string, actionKeys: readonly string[]) => void,
  ): void;
}
