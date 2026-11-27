import type { LiveAgent, LiveConsulting, LiveWaitingOnYou } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import { amenitiesOf, consultSpot, deskOf, deskSpot, layoutOffice } from "./floor-plan.ts";
import { DOOR_OUTSIDE } from "./floor-plan.ts";
import {
  DESK_DEPTHS,
  LIST_GROUPS,
  agentEngineWords,
  agentLineWords,
  doingWords,
  doingsOf,
  lookStateOf,
  lookStatesOf,
  monitorsOf,
  placementsOf,
  stateWords,
  summaryWords,
  walksAtAlarmChange,
  walksAtLightChange,
  workLinksOf,
} from "./live-states.ts";
import {
  DAY_LIGHT,
  FLOOR_SIZES,
  NIGHT_LIGHT,
  floorPeopleOf,
  officePerson,
  rosterOf,
} from "./live-view.fixtures.ts";
import type { IdleDoing, Light, OfficePerson, RecordTitles, Seat } from "./live-view-types.ts";
import { type PastimeTurn, pastimeTurnAt, pastimeTurnOf } from "./pastimes.ts";

const NOW = new Date(2026, 10, 15, 13, 5);
const DAY = DAY_LIGHT;
const NIGHT = NIGHT_LIGHT;

const THREAD = "00000000-0000-4000-8000-000000000001";
const OTHER_THREAD = "00000000-0000-4000-8000-000000000002";
const DECISION = "00000000-0000-4000-8000-0000000000d1";

const TITLES: RecordTitles = {
  tasks: new Map([["task-1", "Fix the door"]]),
  initiatives: new Map([["initiative-1", "Office visualisation"]]),
};
const NAMES = new Map(rosterOf(30).map((person) => [person.roleKey, person.name]));

function minutesAgo(minutes: number): string {
  return new Date(NOW.getTime() - minutes * 60_000).toISOString();
}

function stage(taskId = "task-1", threadId = THREAD): LiveAgent {
  return {
    threadId,
    home: { kind: "task", taskId },
    kind: "stage",
    consultation: null,
    engine: null,
    since: null,
  };
}

function asking(consultantRoleKey: string): LiveConsulting {
  return {
    decisionId: DECISION,
    threadId: OTHER_THREAD,
    home: { kind: "task", taskId: "task-1" },
    consultantRoleKey,
    question: "Which way?",
    since: minutesAgo(2),
  };
}

function waiting(home: LiveWaitingOnYou["home"]): LiveWaitingOnYou {
  return {
    decisionId: DECISION,
    threadId: OTHER_THREAD,
    home,
    byTheOffice: false,
    question: "Ship it?",
    since: minutesAgo(1),
  };
}

function working(roleKey: string, agents: LiveAgent[] = [stage()]): OfficePerson {
  return officePerson(roleKey, { state: "working", agents });
}

function consulting(roleKey: string, consultantRoleKey: string): OfficePerson {
  return officePerson(roleKey, { state: "consulting", consulting: [asking(consultantRoleKey)] });
}

function idleFor(roleKey: string, minutes: number): OfficePerson {
  return officePerson(roleKey, { idleSince: minutesAgo(minutes) });
}

/** The first whole minute from `from` on whose turn `holds`, by day (counting from `idleSince`). */
function minutesWhen(roleKey: string, holds: (turn: PastimeTurn) => boolean, from = 0): number {
  for (let minutes = from; minutes < from + 24 * 60; minutes++) {
    if (holds(pastimeTurnAt(roleKey, minutes))) return minutes;
  }
  throw new Error(`No such turn for ${roleKey} within a day of ${from} minutes.`);
}

const isNap = (turn: PastimeTurn): boolean => turn.pastime === "nap";

/** Idle long enough, by day, that their turn picked a nap. */
function napping(roleKey: string): OfficePerson {
  return idleFor(roleKey, minutesWhen(roleKey, isNap));
}

/** Idle by day for as long as it takes their turn to pick the sofa. */
function onTheSofa(roleKey: string): OfficePerson {
  return idleFor(
    roleKey,
    minutesWhen(roleKey, (turn) => turn.pastime === "sofa"),
  );
}

/** What someone idle is doing: having a coffee, but for what a test overrides. */
function doing(overrides: Partial<IdleDoing>): IdleDoing {
  return { pastime: "coffee", exercise: null, chatting: false, ...overrides };
}

/** The eight with someone swapped in by Role key. */
function eightWith(...people: OfficePerson[]): OfficePerson[] {
  return rosterOf(8).map(
    (person) =>
      people.find((other) => other.roleKey === person.roleKey) ?? idleFor(person.roleKey, 40),
  );
}

function placed(people: OfficePerson[], light = DAY) {
  const layout = layoutOffice(people);
  return { layout, placements: placementsOf(people, layout, amenitiesOf(layout), light, NOW) };
}

describe("look states", () => {
  it("follows the snapshot's headline", () => {
    expect(lookStateOf(working("developer"), NOW, DAY)).toBe("working");
    expect(lookStateOf(consulting("developer", "cto"), NOW, DAY)).toBe("consulting");
    const waitingPerson = officePerson("developer", {
      state: "waiting-on-you",
      waitingOnYou: [waiting({ kind: "task", taskId: "task-1" })],
    });
    expect(lookStateOf(waitingPerson, NOW, DAY)).toBe("waiting-on-you");
  });

  it("is asleep only in a turn that picked a nap, never in the first thirty minutes", () => {
    for (let minutes = 0; minutes < 30; minutes++) {
      expect(lookStateOf(idleFor("developer", minutes), NOW, DAY)).toBe("idle");
    }
    for (let minutes = 0; minutes < 12 * 60; minutes += 1) {
      const nap = pastimeTurnAt("developer", minutes).pastime === "nap";
      expect(lookStateOf(idleFor("developer", minutes), NOW, DAY)).toBe(nap ? "asleep" : "idle");
    }
    expect(lookStateOf(napping("developer"), NOW, DAY)).toBe("asleep");
  });

  it("shows someone hired within the hour as just joined, then idle", () => {
    expect(
      lookStateOf(
        officePerson("developer", { hiredAt: minutesAgo(59), idleSince: minutesAgo(59) }),
        NOW,
        DAY,
      ),
    ).toBe("joined");
    expect(
      lookStateOf(
        officePerson("developer", { hiredAt: minutesAgo(60), idleSince: minutesAgo(5) }),
        NOW,
        DAY,
      ),
    ).toBe("idle");
  });

  it("sends someone idle home only at night", () => {
    expect(lookStateOf(idleFor("developer", 5), NOW, NIGHT)).toBe("home");
    expect(lookStateOf(idleFor("developer", 45), NOW, NIGHT)).toBe("home");
    for (const phase of ["day", "dusk", "dawn"] as const) {
      expect(lookStateOf(idleFor("developer", 5), NOW, { ...DAY, phase })).toBe("idle");
    }
  });

  it("keeps the working, the consulting and those waiting on you at night", () => {
    expect(lookStateOf(working("developer"), NOW, NIGHT)).toBe("working");
    expect(lookStateOf(consulting("developer", "cto"), NOW, NIGHT)).toBe("consulting");
    const waitingPerson = officePerson("developer", {
      state: "waiting-on-you",
      waitingOnYou: [waiting({ kind: "task", taskId: "task-1" })],
    });
    expect(lookStateOf(waitingPerson, NOW, NIGHT)).toBe("waiting-on-you");
  });

  it("shows a hire as just joined even at night", () => {
    const hire = officePerson("developer", { hiredAt: minutesAgo(10), idleSince: minutesAgo(10) });
    expect(lookStateOf(hire, NOW, NIGHT)).toBe("joined");
  });

  it("counts the thirty minutes to asleep from dawn for those idle all night", () => {
    const afterDawn = (minutes: number): Light => ({
      ...DAY,
      phase: "dawn",
      dawnAt: NOW.getTime() - minutes * 60_000,
    });
    const idleAllNight = idleFor("developer", 600);
    for (let minutes = 0; minutes < 30; minutes++) {
      expect(lookStateOf(idleAllNight, NOW, afterDawn(minutes))).toBe("idle");
    }
    const napAfterDawn = minutesWhen("developer", isNap);
    expect(lookStateOf(idleAllNight, NOW, afterDawn(napAfterDawn))).toBe("asleep");
    expect(
      lookStateOf(
        idleAllNight,
        NOW,
        afterDawn(minutesWhen("developer", (turn) => !isNap(turn), napAfterDawn)),
      ),
    ).toBe("idle");
    // Someone who went idle after dawn counts from then, as by day.
    expect(lookStateOf(idleFor("developer", napAfterDawn), NOW, afterDawn(600))).toBe("asleep");
  });
});

/** A light the floor was given that many minutes ago. */
function seen(light: Light, minutesBefore: number) {
  return { light, at: new Date(NOW.getTime() - minutesBefore * 60_000) };
}

describe("walks at a change of light", () => {
  it("walks when night begins or ends in front of the viewer", () => {
    expect(walksAtLightChange(seen({ ...DAY, phase: "dusk" }, 1), NIGHT, NOW)).toBe(true);
    expect(walksAtLightChange(seen(NIGHT, 1), { ...DAY, phase: "dawn" }, NOW)).toBe(true);
  });

  it("doesn't walk when the phase changes elsewhere in the day", () => {
    expect(walksAtLightChange(seen({ ...DAY, phase: "dawn" }, 1), DAY, NOW)).toBe(false);
    expect(walksAtLightChange(seen(DAY, 1), { ...DAY, phase: "dusk" }, NOW)).toBe(false);
    expect(walksAtLightChange(seen(NIGHT, 1), NIGHT, NOW)).toBe(false);
  });

  it("puts people in place after a hidden tab or a sleeping machine, or on the first light", () => {
    expect(walksAtLightChange(seen({ ...DAY, phase: "dusk" }, 2), NIGHT, NOW)).toBe(false);
    expect(walksAtLightChange(seen(DAY, 600), NIGHT, NOW)).toBe(false);
    expect(walksAtLightChange(null, NIGHT, NOW)).toBe(false);
  });
});

/** The alarm as the floor was given it that many minutes ago. */
function alarmSeen(on: boolean, minutesBefore: number) {
  return { on, at: new Date(NOW.getTime() - minutesBefore * 60_000) };
}

describe("the fire alarm", () => {
  it("puts everyone out while it is on, desks kept, and back at the all clear", () => {
    const people = eightWith(working("developer"), idleFor("office-manager", 5), napping("cto"));
    const layout = layoutOffice(people);
    const amenities = amenitiesOf(layout);
    const out = placementsOf(people, layout, amenities, DAY, NOW, true);
    expect(out.size).toBe(people.length);
    for (const placement of out.values())
      expect(placement).toMatchObject({ kind: "gone", spot: DOOR_OUTSIDE, doing: null });
    for (const person of people) expect(deskOf(layout, person.roleKey)).toBeDefined();
    const back = placementsOf(people, layout, amenities, DAY, NOW, false);
    expect(back).toEqual(placementsOf(people, layout, amenities, DAY, NOW));
    expect(back.get("developer")?.kind).toBe("desk");
  });

  it("walks people only when it sounds or clears in front of the viewer", () => {
    expect(walksAtAlarmChange(alarmSeen(false, 0), true, NOW)).toBe(true);
    expect(walksAtAlarmChange(alarmSeen(true, 1), false, NOW)).toBe(true);
    expect(walksAtAlarmChange(alarmSeen(true, 1), true, NOW)).toBe(false);
    expect(walksAtAlarmChange(alarmSeen(false, 1), false, NOW)).toBe(false);
  });

  it("puts people in place after a hidden tab or a sleeping machine, or on the page's first look", () => {
    expect(walksAtAlarmChange(alarmSeen(false, 2), true, NOW)).toBe(false);
    expect(walksAtAlarmChange(alarmSeen(true, 600), false, NOW)).toBe(false);
    expect(walksAtAlarmChange(null, true, NOW)).toBe(false);
  });

  it("says in the summary that the alarm is on and everyone is out", () => {
    const people = eightWith(working("developer"), idleFor("office-manager", 5));
    expect(summaryWords(people, DAY, lookStatesOf(people, NOW, DAY), true)).toBe(
      "8 people: the fire alarm is on, everyone is out of the office. Day, 13:05.",
    );
    expect(summaryWords([], NIGHT, new Map(), true)).toBe(
      "0 people: the fire alarm is on, nobody is in the office. Night, 22:30.",
    );
    expect(summaryWords(people, DAY, lookStatesOf(people, NOW, DAY), false)).toBe(
      summaryWords(people, DAY, lookStatesOf(people, NOW, DAY)),
    );
  });

  it("keeps those still at work at their desks under a softer way, everyone else out", () => {
    const people = eightWith(working("developer"), idleFor("office-manager", 5), napping("cto"));
    const layout = layoutOffice(people);
    const out = placementsOf(people, layout, amenitiesOf(layout), DAY, NOW, true, true);
    expect(out.get("developer")?.kind).toBe("desk");
    expect(out.get("office-manager")?.kind).toBe("gone");
    expect(out.get("cto")?.kind).toBe("gone");
    expect(summaryWords(people, DAY, lookStatesOf(people, NOW, DAY), true, true)).toBe(
      "8 people: the fire alarm is on, 1 still at work, everyone else is out of the office. Day, 13:05.",
    );
  });
});

describe("placements", () => {
  it("seats the working, the waiting and the asleep at their desk", () => {
    const waitingPerson = officePerson("reviewer", {
      state: "waiting-on-you",
      waitingOnYou: [waiting({ kind: "task", taskId: "task-1" })],
    });
    const { layout, placements } = placed(
      eightWith(working("developer"), waitingPerson, napping("cto")),
    );
    const developerDesk = deskOf(layout, "developer")!;
    expect(placements.get("developer")).toMatchObject({
      kind: "desk",
      spot: deskSpot(developerDesk),
      activity: "working",
      pose: "sit-back",
      facing: "back",
      depth: developerDesk.depth + DESK_DEPTHS.sitter,
      conversation: null,
    });
    expect(placements.get("reviewer")).toMatchObject({
      kind: "desk",
      activity: "waiting",
      pose: "sit-back-raise",
    });
    expect(placements.get("cto")).toMatchObject({
      kind: "desk",
      activity: "asleep",
      pose: "sit-back-sleep",
    });
  });

  it("draws whoever sits at a desk over its screens, lamp, bulb and their glows", () => {
    const { layout, placements } = placed(eightWith(working("developer")));
    const desk = deskOf(layout, "developer")!;
    const sitter = placements.get("developer")!.depth;
    const glows = desk.depth + DESK_DEPTHS.lampGlow;
    expect(desk.depth + DESK_DEPTHS.screenGlow).toBeLessThan(glows);
    for (const under of [DESK_DEPTHS.screen, DESK_DEPTHS.lamp, DESK_DEPTHS.bulb, DESK_DEPTHS.seat])
      expect(desk.depth + under).toBeLessThan(glows);
    expect(glows).toBeLessThan(sitter);
    expect(sitter).toBeLessThan(desk.depth + DESK_DEPTHS.chairBack);
  });

  it("puts someone idle at a spot of their pick", () => {
    const awake = [0, 5, 17, 42, 133, 301, 455].filter(
      (minutes) => !isNap(pastimeTurnAt("developer", minutes)),
    );
    expect(awake.length).toBeGreaterThan(3);
    for (const minutes of awake) {
      const developer = idleFor("developer", minutes);
      const turn = pastimeTurnOf(developer, NOW, DAY);
      const others = rosterOf(8)
        .filter((person) => person.roleKey !== "developer")
        .map((person) => working(person.roleKey));
      const placement = placed([...others, developer]).placements.get("developer")!;
      expect(placement).toMatchObject({
        kind: "pastime",
        spot: { kind: turn.pastime },
        doing: {
          pastime: turn.pastime,
          exercise: turn.pastime === "exercise" ? turn.exercise : null,
          chatting: false,
        },
        activity: null,
      });
      expect(doingsOf(placed([...others, developer]).placements)).toEqual(
        new Map([["developer", placement.doing]]),
      );
    }
  });

  it("poses each pastime at its spot", () => {
    const expected: Record<string, string> = {
      coffee: "stand-front-mug",
      water: "stand-front-cup",
      sofa: "sit-front",
      beanbag: "sit-front-phone",
      bookshelf: "stand-back-read",
      plant: "stand-back-water",
      games: "sit-back-play",
    };
    const exercises: Record<string, string> = {
      "jumping-jacks": "stand-front-jacks",
      squats: "stand-front-squat",
      "push-ups": "lie-front-push-up",
    };
    const posed = new Set<string>();
    for (const roleKey of rosterOf(30).map((person) => person.roleKey)) {
      for (let minutes = 0; minutes < 6 * 60; minutes += 7) {
        const turn = pastimeTurnAt(roleKey, minutes);
        if (turn.pastime === "nap") continue;
        const people = floorPeopleOf(30).map((person) =>
          person.roleKey === roleKey ? idleFor(roleKey, minutes) : working(person.roleKey),
        );
        const placement = placed(people).placements.get(roleKey)!;
        const pose =
          turn.pastime === "exercise" ? exercises[turn.exercise] : expected[turn.pastime];
        expect(placement.pose).toBe(pose);
        posed.add(turn.pastime === "exercise" ? turn.exercise : turn.pastime);
        if (posed.size === 10) return;
      }
    }
    expect([...posed].toSorted()).toEqual(
      [...Object.keys(expected), ...Object.keys(exercises)].toSorted(),
    );
  });

  it.each(FLOOR_SIZES)(
    "never puts two people on one spot of the %i-person floor, everyone idle",
    (count) => {
      for (const minutes of [0, 4, 9, 30, 47, 90, 200, 333, 480, 700]) {
        const people = floorPeopleOf(count).map((person, index) =>
          idleFor(person.roleKey, minutes + index * 3),
        );
        const { placements } = placed(people);
        const spots = [...placements.values()].map(({ spot }) => `${spot.x},${spot.y}`);
        expect(new Set(spots).size).toBe(people.length);
      }
    },
  );

  it("takes the next pastime in their order with a spot free, then the desk, in hire order", () => {
    for (const minutes of [0, 5, 13, 40, 120]) {
      const people = floorPeopleOf(30).map((person) => idleFor(person.roleKey, minutes));
      const layout = layoutOffice(people);
      const amenities = amenitiesOf(layout);
      const placements = placementsOf(people, layout, amenities, DAY, NOW);
      const taken = new Set<Seat>();
      const expected = people.map((person) => {
        const turn = pastimeTurnOf(person, NOW, DAY);
        // The first spot, in the floor's order, of the first pastime in their order with one free.
        const free = turn.preferences
          .map((pastime) =>
            amenities.pastimeSpots.find((spot) => spot.kind === pastime && !taken.has(spot)),
          )
          .find((spot) => spot !== undefined);
        if (free !== undefined) {
          taken.add(free);
          return { kind: "pastime", spot: free };
        }
        const nap = isNap(turn);
        return {
          kind: "desk",
          spot: deskSpot(deskOf(layout, person.roleKey)!),
          pose: nap ? "sit-back-sleep" : "sit-back-stretch",
          doing: { pastime: nap ? "nap" : "desk" },
        };
      });
      expect(people.map((person) => placements.get(person.roleKey))).toMatchObject(expected);
      const atDesks = expected.filter((placement) => placement.kind === "desk").length;
      // Thirty people idle are more than the floor's spots: some sit back at their desk.
      expect(atDesks).toBeGreaterThan(0);
      expect(people.length - atDesks).toBeLessThanOrEqual(amenities.pastimeSpots.length);
    }
  });

  it("sits someone idle whose every spot is taken back at their desk, stretching", () => {
    const people = floorPeopleOf(30).map((person) => idleFor(person.roleKey, 5));
    const { layout, placements } = placed(people);
    const atDesk = people.filter((person) => placements.get(person.roleKey)?.kind === "desk");
    expect(atDesk.length).toBeGreaterThan(0);
    for (const person of atDesk) {
      expect(placements.get(person.roleKey)).toMatchObject({
        spot: deskSpot(deskOf(layout, person.roleKey)!),
        activity: "idle",
        pose: "sit-back-stretch",
        facing: "back",
        doing: { pastime: "desk", exercise: null, chatting: false },
      });
    }
  });

  it("has two or more on the sofa talk, from its left seat to its right; one alone talks to nobody", () => {
    const pair = placed(eightWith(...["developer", "reviewer"].map(onTheSofa))).placements;
    const sitters = [...pair]
      .filter(
        ([, placement]) => placement.kind === "pastime" && placement.doing?.pastime === "sofa",
      )
      .toSorted(([, a], [, b]) => a.spot.x - b.spot.x)
      .map(([roleKey]) => roleKey);
    expect(sitters).toContain("developer");
    expect(sitters).toContain("reviewer");
    const talk = pair.get("developer")!.conversation;
    expect(talk).toEqual(sitters);
    for (const roleKey of sitters) {
      expect(pair.get(roleKey)!.conversation).toBe(talk);
      expect(pair.get(roleKey)!.doing).toEqual({
        pastime: "sofa",
        exercise: null,
        chatting: true,
      });
    }

    const others = rosterOf(8)
      .filter((person) => person.roleKey !== "developer")
      .map((person) => working(person.roleKey));
    const alone = placed([...others, onTheSofa("developer")]).placements.get("developer")!;
    expect(alone).toMatchObject({
      kind: "pastime",
      conversation: null,
      doing: { pastime: "sofa", chatting: false },
    });
  });

  it("sits someone playing games on a floor pillow, back to us, facing the TV", () => {
    const others = rosterOf(8)
      .filter((person) => person.roleKey !== "developer")
      .map((person) => working(person.roleKey));
    const gamer = idleFor(
      "developer",
      minutesWhen("developer", (turn) => turn.pastime === "games"),
    );
    const people = [...others, gamer];
    const layout = layoutOffice(people);
    const amenities = amenitiesOf(layout);
    const placement = placementsOf(people, layout, amenities, DAY, NOW).get("developer")!;
    const firstPillow = amenities.pastimeSpots.find((spot) => spot.kind === "games")!;
    expect(placement).toMatchObject({
      kind: "pastime",
      spot: firstPillow,
      pose: "sit-back-play",
      facing: "back",
      mirrored: true,
      z: firstPillow.seatZ,
      conversation: null,
      doing: { pastime: "games", exercise: null, chatting: false },
    });
    expect(stateWords(gamer, "idle", TITLES, NAMES, placement.doing)).toBe("Idle: playing games");
  });

  it("stands someone consulting at the Consultant's desk, the Consultant turned round to talk", () => {
    const { layout, placements } = placed(
      eightWith(consulting("developer", "cto"), working("cto")),
    );
    expect(placements.get("developer")).toMatchObject({
      kind: "consult",
      spot: consultSpot(deskOf(layout, "cto")!),
      pose: "stand-back-talk",
      conversation: ["cto", "developer"],
    });
    expect(placements.get("cto")).toMatchObject({
      kind: "desk",
      activity: "talking",
      pose: "sit-front",
      facing: "front",
      conversation: ["cto", "developer"],
    });
  });

  it("has the first of two asking one Consultant at the desk, the other waiting at their own", () => {
    const { layout, placements } = placed(
      eightWith(consulting("developer", "cto"), consulting("reviewer", "cto"), working("cto")),
    );
    expect(placements.get("developer")).toMatchObject({
      kind: "consult",
      spot: consultSpot(deskOf(layout, "cto")!),
      conversation: ["cto", "developer"],
    });
    expect(placements.get("reviewer")).toMatchObject({
      kind: "desk",
      spot: deskSpot(deskOf(layout, "reviewer")!),
      conversation: null,
    });
    expect(placements.get("cto")).toMatchObject({
      kind: "desk",
      activity: "talking",
      conversation: ["cto", "developer"],
    });
  });

  it("leaves at their own desk whoever can't join a Consultant, so no two stand on one spot", () => {
    const people = rosterOf(16).map((person) => {
      if (["developer", "reviewer", "technical-writer", "qa-engineer"].includes(person.roleKey))
        return consulting(person.roleKey, "cto");
      if (["frontend-developer", "backend-developer"].includes(person.roleKey))
        return consulting(person.roleKey, "devops");
      return working(person.roleKey);
    });
    const { layout, placements } = placed(people);
    // The CTO has the first at the desk; the other three wait at their own desks.
    for (const roleKey of ["reviewer", "technical-writer", "qa-engineer"]) {
      expect(placements.get(roleKey)).toMatchObject({
        kind: "desk",
        spot: deskSpot(deskOf(layout, roleKey)!),
      });
    }
    expect(placements.get("developer")).toMatchObject({
      kind: "consult",
      spot: consultSpot(deskOf(layout, "cto")!),
    });
    // Devops, asked by two, has the first at the desk too.
    expect(placements.get("frontend-developer")).toMatchObject({
      kind: "consult",
      spot: consultSpot(deskOf(layout, "devops")!),
    });
    expect(placements.get("backend-developer")).toMatchObject({
      kind: "desk",
      spot: deskSpot(deskOf(layout, "backend-developer")!),
    });
  });

  it("takes someone gone home off the floor, out of the door, keeping their desk", () => {
    const { layout, placements } = placed(eightWith(idleFor("developer", 5)), NIGHT);
    expect(placements.get("developer")).toMatchObject({ kind: "gone", spot: DOOR_OUTSIDE });
    expect(deskOf(layout, "developer")).toBeDefined();
  });

  it("brings someone at home back to their desk once they start work at night", () => {
    const { layout, placements } = placed(eightWith(working("developer")), NIGHT);
    expect(placements.get("developer")).toMatchObject({
      kind: "desk",
      spot: deskSpot(deskOf(layout, "developer")!),
    });
  });
});

describe("monitors", () => {
  it("lights one monitor per session, a laptop for someone who only talks", () => {
    expect(monitorsOf(working("developer", [stage(), stage()]), "working")).toEqual({
      shown: 3,
      lit: 2,
      laptop: false,
      tag: null,
    });
    expect(monitorsOf(working("office-manager", [stage()]), "working")).toEqual({
      shown: 1,
      lit: 1,
      laptop: true,
      tag: null,
    });
  });

  it("counts sessions past those shown in a green tag", () => {
    const extra = monitorsOf(working("cto", [stage(), stage(), stage()]), "working");
    expect(extra).toEqual({ shown: 2, lit: 2, laptop: false, tag: { count: 1, lit: true } });
  });

  it("counts monitors past three in a dark tag until a session runs on them", () => {
    expect(monitorsOf(working("ml-engineer", [stage()]), "working").tag).toEqual({
      count: 2,
      lit: false,
    });
    expect(
      monitorsOf(working("ml-engineer", [stage(), stage(), stage(), stage()]), "working").tag,
    ).toEqual({ count: 2, lit: true });
  });

  it("lights nothing once they have gone home", () => {
    expect(monitorsOf(working("developer"), "home").lit).toBe(0);
  });
});

describe("words and links", () => {
  it("names each running session by its record", () => {
    const person = working("developer", [
      stage(),
      {
        threadId: OTHER_THREAD,
        home: { kind: "initiative", initiativeId: "initiative-1" },
        kind: "thread",
        consultation: null,
        engine: null,
        since: null,
      },
      {
        threadId: THREAD,
        home: { kind: "chat", roleKey: "developer" },
        kind: "thread",
        consultation: null,
        engine: null,
        since: null,
      },
    ]);
    expect(stateWords(person, "working", TITLES, NAMES)).toBe(
      'Working on a Stage of the Task "Fix the door", the Initiative "Office visualisation" and a chat',
    );
    expect(stateWords(consulting("developer", "cto"), "consulting", TITLES, NAMES)).toBe(
      'Asking Michael: "Which way?"',
    );
    expect(stateWords(idleFor("developer", 40), "asleep", TITLES, NAMES)).toMatch(
      /^Asleep at their desk/,
    );
  });

  it("links the Decision first, then each session's Thread", () => {
    const person = officePerson("developer", {
      state: "waiting-on-you",
      waitingOnYou: [waiting({ kind: "task", taskId: "task-1" })],
      agents: [stage("task-1", THREAD)],
    });
    expect(workLinksOf(person, TITLES, NAMES).map((link) => link.target)).toEqual([
      { kind: "task", taskId: "task-1", threadId: OTHER_THREAD, decisionId: DECISION },
      { kind: "task", taskId: "task-1", threadId: THREAD, decisionId: null },
    ]);
  });

  it("links each session by its home", () => {
    const person = working("cto", [
      {
        threadId: THREAD,
        home: { kind: "initiative", initiativeId: "initiative-1" },
        kind: "thread",
        consultation: null,
        engine: null,
        since: null,
      },
      {
        threadId: OTHER_THREAD,
        home: { kind: "chat", roleKey: "cto" },
        kind: "thread",
        consultation: null,
        engine: null,
        since: null,
      },
      {
        threadId: OTHER_THREAD,
        home: { kind: "chat", roleKey: "cto" },
        kind: "thread",
        consultation: null,
        engine: null,
        since: null,
      },
    ]);
    expect(workLinksOf(person, TITLES, NAMES).map((link) => link.target)).toEqual([
      { kind: "initiative", initiativeId: "initiative-1", threadId: THREAD },
      { kind: "chat", roleKey: "cto", threadId: OTHER_THREAD },
    ]);
  });

  it("names the engine a session runs on, and the one a Stand-in Engine stands in for", () => {
    const reason = "Work's 5-hour window would be passed; Personal had room.";
    const onWork: LiveAgent = {
      ...stage(),
      engine: { engineId: "work", engineName: "Work", standInFor: null },
    };
    const standingIn: LiveAgent = {
      ...stage(),
      engine: {
        engineId: "personal",
        engineName: "Personal",
        standInFor: { engineId: "work", engineName: "Work", reason },
      },
    };
    expect(agentEngineWords(stage())).toBe("");
    expect(agentEngineWords(onWork)).toBe(" on Work");
    expect(agentLineWords(standingIn, TITLES, NAMES)).toBe(
      'a Stage of the Task "Fix the door" on Personal, standing in for Work',
    );
    expect(workLinksOf(working("developer", [onWork]), TITLES, NAMES)).toEqual([
      {
        words: 'A Stage of the Task "Fix the door" on Work',
        target: { kind: "task", taskId: "task-1", threadId: THREAD, decisionId: null },
      },
    ]);
    expect(workLinksOf(working("developer", [standingIn]), TITLES, NAMES)).toEqual([
      {
        words: 'A Stage of the Task "Fix the door" on Personal, standing in for Work',
        target: { kind: "task", taskId: "task-1", threadId: THREAD, decisionId: null },
        reason,
      },
    ]);
  });

  it("offers someone idle their chat and their page on People", () => {
    expect(workLinksOf(idleFor("cto", 5), TITLES, NAMES).map((link) => link.target)).toEqual([
      { kind: "chat", roleKey: "cto", threadId: null },
      { kind: "person", roleKey: "cto" },
    ]);
    expect(workLinksOf(idleFor("developer", 5), TITLES, NAMES).map((link) => link.target)).toEqual([
      { kind: "person", roleKey: "developer" },
    ]);
  });

  it("sums the office up", () => {
    const people = eightWith(
      working("developer"),
      working("reviewer"),
      working("devops"),
      working("planner"),
      consulting("ui-ux-designer", "cto"),
      officePerson("caretaker", {
        state: "waiting-on-you",
        waitingOnYou: [waiting({ kind: "chat", roleKey: "caretaker" })],
      }),
      idleFor("office-manager", 5),
      napping("cto"),
    );
    expect(summaryWords(people, DAY, lookStatesOf(people, NOW, DAY))).toBe(
      "8 people: 4 working, 1 consulting, 1 waiting on you, 1 idle, 1 asleep. Day, 13:05.",
    );
    const one = [working("developer")];
    expect(summaryWords(one, DAY, lookStatesOf(one, NOW, DAY))).toBe(
      "1 person: 1 working. Day, 13:05.",
    );
  });

  it("counts those gone home and says it is night", () => {
    const people = eightWith(
      working("developer"),
      working("reviewer"),
      officePerson("caretaker", {
        state: "waiting-on-you",
        waitingOnYou: [waiting({ kind: "chat", roleKey: "caretaker" })],
      }),
    );
    expect(summaryWords(people, NIGHT, lookStatesOf(people, NOW, NIGHT))).toBe(
      "8 people: 2 working, 1 waiting on you, 5 gone home. Night, 22:30.",
    );
  });

  it("counts asleep in the summary just as the look states do: those whose turn is a nap", () => {
    const people = rosterOf(30).map((person, index) => idleFor(person.roleKey, 31 + index * 13));
    const naps = people.filter(
      (person) => pastimeTurnOf(person, NOW, DAY).pastime === "nap",
    ).length;
    expect(naps).toBeGreaterThan(0);
    expect(naps).toBeLessThan(30);
    const lookStates = lookStatesOf(people, NOW, DAY);
    expect([...lookStates.values()].filter((state) => state === "asleep")).toHaveLength(naps);
    expect(summaryWords(people, DAY, lookStates)).toBe(
      `30 people: ${30 - naps} idle, ${naps} asleep. Day, 13:05.`,
    );
  });

  it("says what someone idle is doing", () => {
    const idle = idleFor("developer", 5);
    expect(stateWords(idle, "idle", TITLES, NAMES, doing({}))).toBe("Idle: having a coffee");
    expect(
      stateWords(idle, "idle", TITLES, NAMES, doing({ pastime: "exercise", exercise: "push-ups" })),
    ).toBe("Idle: doing push-ups");
    expect(
      stateWords(idle, "idle", TITLES, NAMES, doing({ pastime: "sofa", chatting: true })),
    ).toBe("Idle: chatting on the sofa");
    expect(stateWords(idle, "idle", TITLES, NAMES)).toBe("Idle");
    expect(stateWords(idle, "asleep", TITLES, NAMES, doing({ pastime: "nap" }))).toBe(
      "Asleep at their desk: idle for 30 minutes or more",
    );
    expect(
      [
        doing({ pastime: "coffee" }),
        doing({ pastime: "water" }),
        doing({ pastime: "sofa" }),
        doing({ pastime: "sofa", chatting: true }),
        doing({ pastime: "beanbag" }),
        doing({ pastime: "exercise", exercise: "jumping-jacks" }),
        doing({ pastime: "exercise", exercise: "squats" }),
        doing({ pastime: "exercise", exercise: "push-ups" }),
        doing({ pastime: "bookshelf" }),
        doing({ pastime: "plant" }),
        doing({ pastime: "games" }),
        doing({ pastime: "nap" }),
        doing({ pastime: "desk" }),
      ].map(doingWords),
    ).toEqual([
      "having a coffee",
      "having a cup of water",
      "relaxing on the sofa",
      "chatting on the sofa",
      "on their phone in a beanbag",
      "doing jumping jacks",
      "doing squats",
      "doing push-ups",
      "browsing the bookshelf",
      "watering a plant",
      "playing games",
      "napping at their desk",
      "stretching at their desk",
    ]);
  });

  it("says someone at home has gone home for the night", () => {
    expect(stateWords(idleFor("developer", 5), "home", TITLES, NAMES)).toBe(
      "Gone home for the night: idle",
    );
  });

  it("groups the list in its order", () => {
    expect(LIST_GROUPS.map((group) => group.words)).toEqual([
      "Waiting on you",
      "Consulting",
      "Working",
      "Just joined",
      "Idle",
      "Asleep at their desk",
      "Gone home",
    ]);
  });
});
