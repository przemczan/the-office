import type { ActivityPerson, ActivitySession, SubjectActivity } from "@the-office/contracts";

/** One activity as one person is in it: only that person's sessions on it. */
export interface PersonActivity {
  readonly activity: SubjectActivity;
  readonly sessions: readonly ActivitySession[];
}

/** One person, or The Office, with the activities they are in. */
export interface PersonSessions {
  /** Stable across reads: the Role key, or "the-office". */
  readonly key: string;
  readonly person: ActivityPerson;
  readonly activities: readonly PersonActivity[];
}

export const THE_OFFICE_KEY = "the-office";

export function personKey(person: ActivityPerson): string {
  return person.kind === "person" ? person.roleKey : THE_OFFICE_KEY;
}

/**
 * One entry per person, the one whose latest session began most recently first and The Office
 * last; each lists their activities newest first, with only their own sessions on them.
 */
export function byPerson(activities: readonly SubjectActivity[]): readonly PersonSessions[] {
  const people = new Map<string, { person: ActivityPerson; activities: PersonActivity[] }>();
  for (const activity of activities) {
    for (const [key, person, sessions] of sessionsOfPeople(activity)) {
      const entry = people.get(key) ?? { person, activities: [] };
      entry.activities.push({ activity, sessions });
      people.set(key, entry);
    }
  }
  return [...people]
    .map(([key, { person, activities: personActivities }]) => ({
      key,
      person,
      activities: personActivities.toSorted(
        (first, second) => latestSince(second.sessions) - latestSince(first.sessions),
      ),
    }))
    .toSorted((first, second) => {
      if (first.key === THE_OFFICE_KEY || second.key === THE_OFFICE_KEY) {
        return Number(first.key === THE_OFFICE_KEY) - Number(second.key === THE_OFFICE_KEY);
      }
      return latestSince(second.activities) - latestSince(first.activities);
    });
}

/** The activities as answered, each with its people: one row per session. */
export function bySubject(activities: readonly SubjectActivity[]): readonly SubjectActivity[] {
  return activities;
}

/** The activity's sessions split by who is in them, in the order each person first appears. */
function sessionsOfPeople(
  activity: SubjectActivity,
): readonly (readonly [string, ActivityPerson, ActivitySession[]])[] {
  const split = new Map<string, [ActivityPerson, ActivitySession[]]>();
  for (const session of activity.sessions) {
    const key = personKey(session.person);
    const entry = split.get(key) ?? [session.person, []];
    entry[1].push(session);
    split.set(key, entry);
  }
  return [...split].map(([key, [person, sessions]]) => [key, person, sessions] as const);
}

function latestSince(items: readonly ActivitySession[] | readonly PersonActivity[]): number {
  return Math.max(
    ...items.flatMap((item) => ("sessions" in item ? item.sessions.map(sinceOf) : [sinceOf(item)])),
  );
}

function sinceOf({ since }: ActivitySession): number {
  return Date.parse(since);
}
