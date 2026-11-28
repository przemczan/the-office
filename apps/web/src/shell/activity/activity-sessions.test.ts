import { describe, expect, it } from "vitest";
import { minutesAgo, sessionOf, subjectActivity } from "./activity.fixtures.ts";
import { byPerson, bySubject } from "./activity-sessions.ts";

const developer = { kind: "person", roleKey: "developer" } as const;
const reviewer = { kind: "person", roleKey: "reviewer" } as const;
const office = { kind: "the-office" } as const;

describe("Sessions by person", () => {
  it("lists one entry per person, the one most recently started first and The Office last", () => {
    const task = subjectActivity({
      id: "task:1",
      sessions: [
        sessionOf({ person: office, sessionKind: "gate", threadId: null, since: minutesAgo(1) }),
        sessionOf({ person: developer, since: minutesAgo(30) }),
        sessionOf({ person: reviewer, since: minutesAgo(5) }),
      ],
    });

    expect(byPerson([task]).map(({ key }) => key)).toEqual(["reviewer", "developer", "the-office"]);
  });

  it("gives each person only their own sessions on an activity, their activities newest first", () => {
    const older = subjectActivity({
      id: "task:older",
      sessions: [
        sessionOf({ person: developer, since: minutesAgo(40) }),
        sessionOf({ person: reviewer, since: minutesAgo(2) }),
      ],
    });
    const newer = subjectActivity({
      id: "task:newer",
      sessions: [sessionOf({ person: developer, since: minutesAgo(10) })],
    });

    const [first, second] = byPerson([older, newer]);

    expect(first?.key).toBe("reviewer");
    expect(first?.activities.map(({ activity }) => activity.id)).toEqual(["task:older"]);
    expect(second?.key).toBe("developer");
    expect(second?.activities.map(({ activity }) => activity.id)).toEqual([
      "task:newer",
      "task:older",
    ]);
    expect(second?.activities[1]?.sessions).toHaveLength(1);
    expect(second?.activities[1]?.sessions[0]?.person).toEqual(developer);
  });

  it("keeps one person's several sessions on one activity together", () => {
    const task = subjectActivity({
      sessions: [
        sessionOf({ stageName: "Implement" }),
        sessionOf({ sessionKind: "consultation", stageName: null, since: minutesAgo(3) }),
      ],
    });

    const [only] = byPerson([task]);

    expect(only?.activities).toHaveLength(1);
    expect(only?.activities[0]?.sessions).toHaveLength(2);
  });

  it("is empty with no activities", () => {
    expect(byPerson([])).toEqual([]);
  });
});

describe("Sessions by subject", () => {
  it("lists the activities as answered, each with every session", () => {
    const first = subjectActivity({ id: "task:1" });
    const second = subjectActivity({
      id: "task:2",
      sessions: [sessionOf({ person: developer }), sessionOf({ person: reviewer })],
    });

    expect(bySubject([first, second])).toEqual([first, second]);
  });
});
