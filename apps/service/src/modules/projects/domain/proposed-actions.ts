import {
  ACTION_FIELDS,
  actionLabel,
  actionProblems,
  changedFields,
  markedAction,
  sameField,
  setByAfter,
  trimmedAction,
  type Action,
  type ActionContext,
  type ActionField,
  type ActionFields,
  type ActionSetter,
} from "./action.js";
import { ProjectRefused } from "./project-refused.js";

/**
 * An Action added (`from` null), changed, or removed (`to` null), by its key, as the Project had
 * it when the Proposal was drafted and as proposed. `userSet` names the values the user set that
 * it changes, each named by the Agent on purpose, which its card flags "You set this".
 */
export interface ProposedAction {
  readonly key: string;
  readonly from: ActionFields | null;
  readonly to: ActionFields | null;
  readonly userSet: readonly ActionField[];
}

/** What a Proposal of Actions changes (spec §2.15, "Defining Actions"); the rest stay. */
export interface ProposedActions {
  readonly actions: readonly ProposedAction[];
}

/** What the Agent gives: only what changes. */
export interface ActionsToPropose {
  /** Each added, or changed by its key, whole. */
  readonly actions: readonly ActionFields[];
  /** The keys of the Actions to remove. */
  readonly removeActions?: readonly string[] | undefined;
  /** The values the user set that it changes on purpose, each as `key.field`, such as `release.name`. */
  readonly changeUserSet?: readonly string[] | undefined;
}

/** The Action as a Proposal carries it: without who set what. */
export function proposedFieldsOf(action: Action): ActionFields {
  const { setBy: _setBy, ...fields } = action;
  return fields;
}

/**
 * What of `given` differs from the Project's Actions, each with the Action now and as proposed,
 * marked as the rules mark it (a new Workflow leaves the workstation). A key given twice keeps the last; a key also removed is removed.
 * Refused when it changes a value the user set that `changeUserSet` doesn't name (removing an
 * Action changes each of its values), when it removes a key the Project lacks, or when it changes
 * nothing.
 */
export function proposedActions(
  current: readonly Action[],
  given: ActionsToPropose,
): ProposedActions {
  const proposed = new Map<string, ProposedAction>();
  const missing: string[] = [];
  for (const trimmed of given.actions.map(trimmedAction)) {
    const now = current.find(({ key }) => key === trimmed.key);
    const from = now ? proposedFieldsOf(now) : null;
    // Clearing a mark is refused by `proposedActionsProblems`, which the draft is checked by.
    const to = markedAction(from ?? undefined, trimmed);
    const changed = changedFields(from ?? undefined, to);
    if (from && changed.length === 0) proposed.delete(to.key);
    else {
      proposed.set(to.key, {
        key: to.key,
        from,
        to,
        userSet: now ? userSetAmong(now, changed) : [],
      });
    }
  }
  for (const key of (given.removeActions ?? []).map((each) => each.trim())) {
    const now = current.find((action) => action.key === key);
    if (!now) {
      missing.push(key);
      continue;
    }
    proposed.set(key, {
      key,
      from: proposedFieldsOf(now),
      to: null,
      userSet: userSetAmong(now, ACTION_FIELDS),
    });
  }
  if (missing.length > 0) {
    throw new ProjectRefused(
      missing.map((key) => `The Project has no Action with the key ${key} to remove.`),
    );
  }
  const actions = [...proposed.values()];
  if (actions.length === 0) {
    throw new ProjectRefused([
      "Nothing changes: give the Actions to add or change, each one whole, or the keys to remove.",
    ]);
  }
  const named = new Set((given.changeUserSet ?? []).map((each) => each.trim()));
  const unnamed = actions.flatMap(({ key, userSet }) =>
    userSet.map((field) => `${key}.${field}`).filter((value) => !named.has(value)),
  );
  if (unnamed.length > 0) {
    throw new ProjectRefused([
      `The user set ${unnamed.join(", ")}, which this changes: name each in changeUserSet to change it on purpose, or leave it as it is.`,
    ]);
  }
  return { actions };
}

function userSetAmong(action: Action, fields: readonly ActionField[]): ActionField[] {
  return ACTION_FIELDS.filter(
    (field) => fields.includes(field) && action.setBy[field]?.by === "user",
  );
}

/**
 * Every reason the Proposal can't apply to the Actions as they are: it changes nothing, an Action
 * it changes changed since it was drafted (each named, and checked first), it clears a mark of
 * Leaves the workstation, or its result breaks a rule the Project page keeps too.
 */
export function proposedActionsProblems(
  current: readonly Action[],
  proposed: ProposedActions,
  context: ActionContext,
): string[] {
  if (proposed.actions.length === 0) {
    return ["Nothing changes: the Proposal adds, changes or removes no Action."];
  }
  const keys = proposed.actions.map(({ key }) => key);
  const repeated = new Set(keys.filter((key, index) => keys.indexOf(key) !== index));
  if (repeated.size > 0) {
    return [...repeated].map((key) => `${actionLabel(key)} is proposed more than once.`);
  }
  const stale = proposed.actions.flatMap((action) => staleProblems(current, action));
  if (stale.length > 0) return stale;
  const cleared = proposed.actions.flatMap(({ key, to }) => {
    const now = current.find((action) => action.key === key);
    return now?.leavesTheWorkstation === true && to !== null && !to.leavesTheWorkstation
      ? [
          `${actionLabel(key)}: A Proposal may mark an Action Leaves the workstation, never clear the mark; only the user clears it.`,
        ]
      : [];
  });
  if (cleared.length > 0) return cleared;
  return actionProblems(appliedActions(current, proposed), context);
}

function staleProblems(current: readonly Action[], { key, from, to }: ProposedAction): string[] {
  const now = current.find((action) => action.key === key);
  if (from === null) {
    if (to === null) return [`The Project has no Action with the key ${key}.`];
    return now ? [`${actionLabel(key)} was added since this was proposed.`] : [];
  }
  if (!now) return [`${actionLabel(key)} was removed since this was proposed.`];
  const same = ACTION_FIELDS.every((field) => sameField(field, now, from));
  return same ? [] : [`${actionLabel(key)} changed since this was proposed.`];
}

/**
 * The Actions with the Proposal applied, in their order with added ones last, each marked as the
 * rules mark it; `setter` is stamped on each value it changed. Check `proposedActionsProblems`
 * first.
 */
export function appliedActions(
  current: readonly Action[],
  proposed: ProposedActions,
  setter?: ActionSetter,
): Action[] {
  const byKey = new Map(proposed.actions.map((action) => [action.key, action]));
  const applied: Action[] = [];
  for (const now of current) {
    const change = byKey.get(now.key);
    if (!change) applied.push(now);
    else if (change.to !== null) applied.push(withProposed(now, change.to, setter));
  }
  for (const change of proposed.actions) {
    if (change.to !== null && !current.some((action) => action.key === change.key)) {
      applied.push(withProposed(undefined, change.to, setter));
    }
  }
  return applied;
}

function withProposed(
  before: Action | undefined,
  to: ActionFields,
  setter: ActionSetter | undefined,
): Action {
  const fields = markedAction(before, to);
  return { ...fields, setBy: setter ? setByAfter(before, fields, setter) : (before?.setBy ?? {}) };
}
