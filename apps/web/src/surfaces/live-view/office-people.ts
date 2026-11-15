import type { Initiative, LiveView, Role, Task } from "@the-office/contracts";
import { stateWords, workLinksOf, type PersonNames } from "./live-states.ts";
import type { LookState, OfficePerson, RecordTitles, WorkLink } from "./live-view-types.ts";

/**
 * The snapshot's people, in its order, each with what their Role gives. Someone whose Role isn't
 * loaded yet, as a hire the Roles' query hasn't read again, is left out until it is.
 */
export function officePeopleOf(snapshot: LiveView, roles: readonly Role[]): OfficePerson[] {
  const rolesByKey = new Map(roles.map((role) => [role.key, role]));
  return snapshot.people.flatMap((person) => {
    const role = rolesByKey.get(person.roleKey);
    if (role === undefined) return [];
    return [
      {
        ...person,
        taskLimit: role.card.taskLimit,
        consultant: role.card.capabilities.consultant,
        chat: role.card.capabilities.chat,
        hiredAt: role.hiredAt,
        avatar: role.avatar,
      },
    ];
  });
}

/** Each Task's and Initiative's title by its id, to name what a session runs on. */
export function recordTitlesOf(
  tasks: readonly Task[] | undefined,
  initiatives: readonly Initiative[] | undefined,
): RecordTitles {
  return {
    tasks: new Map((tasks ?? []).map((task) => [task.id, task.title])),
    initiatives: new Map((initiatives ?? []).map((initiative) => [initiative.id, initiative.name])),
  };
}

export function personNamesOf(people: readonly OfficePerson[]): PersonNames {
  return new Map(people.map((person) => [person.roleKey, person.name]));
}

/** A person as the nameplates, the tooltip, the popover and the list show them. */
export interface ShownPerson {
  readonly person: OfficePerson;
  readonly lookState: LookState;
  /** The state in words. */
  readonly words: string;
  readonly links: readonly WorkLink[];
}

export function shownPeopleOf(
  people: readonly OfficePerson[],
  lookStates: ReadonlyMap<string, LookState>,
  titles: RecordTitles,
): ShownPerson[] {
  const names = personNamesOf(people);
  return people.map((person) => {
    const lookState = lookStates.get(person.roleKey) ?? "idle";
    return {
      person,
      lookState,
      words: stateWords(person, lookState, titles, names),
      links: workLinksOf(person, titles, names),
    };
  });
}
