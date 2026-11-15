import type { Home, LiveAgent } from "@the-office/contracts";
import { consultSpot, deskOf, deskSpot, DOOR_OUTSIDE } from "./floor-plan.ts";
import type {
  Amenities,
  Desk,
  DeskActivity,
  Facing,
  FigurePose,
  Layout,
  Light,
  LookState,
  OfficePerson,
  Placement,
  RecordTitles,
  Seat,
  Spot,
  WorkLink,
  WorkTarget,
} from "./live-view-types.ts";

/** Idle this long, someone is back at their desk asleep rather than in the chill area. */
export const ASLEEP_AFTER_MINUTES = 30;
/** How long "New" shows on a hire's nameplate. */
export const NEW_FOR_MINUTES = 60;

const MINUTE = 60_000;

/** Within the first hour after they were hired. */
export function isNewHire(person: Pick<OfficePerson, "hiredAt">, now: Date): boolean {
  return now.getTime() - Date.parse(person.hiredAt) < NEW_FOR_MINUTES * MINUTE;
}

/** What the figure shows: the snapshot's headline, with idle split by how long and who just joined. */
export function lookStateOf(person: OfficePerson, now: Date, light: Light): LookState {
  if (person.state !== "idle") return person.state;
  if (isNewHire(person, now)) return "joined";
  if (light.phase === "night") return "home";
  return isAsleep(person, now) ? "asleep" : "idle";
}

function isAsleep(person: OfficePerson, now: Date): boolean {
  if (person.idleSince === null) return false;
  return now.getTime() - Date.parse(person.idleSince) >= ASLEEP_AFTER_MINUTES * MINUTE;
}

export function lookStatesOf(
  people: readonly OfficePerson[],
  now: Date,
  light: Light,
): ReadonlyMap<string, LookState> {
  return new Map(people.map((person) => [person.roleKey, lookStateOf(person, now, light)]));
}

/* ---------- Where each person is, from what they are doing, with nobody moving ---------- */

type Location =
  | { readonly kind: "desk"; readonly desk: Desk }
  | { readonly kind: "consult"; readonly consultantKey: string; readonly desk: Desk }
  | { readonly kind: "meeting"; readonly seat: Seat; readonly seatIndex: number }
  | { readonly kind: "chill"; readonly seat: Seat }
  | { readonly kind: "gone" };

/** Who asks each Consultant, in hire order, counting only Consultants in the office. */
function askersByConsultant(
  people: readonly OfficePerson[],
  lookStates: ReadonlyMap<string, LookState>,
): Map<string, string[]> {
  const present = new Set(people.map((person) => person.roleKey));
  const askers = new Map<string, string[]>();
  for (const person of people) {
    const consultantKey = person.consulting[0]?.consultantRoleKey;
    if (lookStates.get(person.roleKey) !== "consulting" || consultantKey === undefined) continue;
    if (!present.has(consultantKey)) continue;
    askers.set(consultantKey, [...(askers.get(consultantKey) ?? []), person.roleKey]);
  }
  return askers;
}

/**
 * The meeting spot seats four, so it holds one meeting at a time: the first Consultant asked by two
 * or more, in seat 0, with up to three of them.
 */
function meetingSeatsOf(askers: ReadonlyMap<string, readonly string[]>): Map<string, number> {
  const seats = new Map<string, number>();
  for (const [consultantKey, keys] of askers) {
    if (keys.length < 2) continue;
    [consultantKey, ...keys.slice(0, 3)].forEach((key, seat) => seats.set(key, seat));
    break;
  }
  return seats;
}

/**
 * The one asker who stands at each Consultant's desk: the first, when the Consultant isn't at the
 * meeting spot. Anyone else asking waits at their own desk, so no two figures share one spot.
 */
function deskVisitorsOf(
  askers: ReadonlyMap<string, readonly string[]>,
  meetingSeats: ReadonlyMap<string, number>,
): Map<string, string> {
  const visitors = new Map<string, string>();
  for (const [consultantKey, keys] of askers) {
    const first = keys[0];
    if (first !== undefined && !meetingSeats.has(consultantKey)) visitors.set(first, consultantKey);
  }
  return visitors;
}

function locationsOf(
  people: readonly OfficePerson[],
  layout: Layout,
  amenities: Amenities,
  lookStates: ReadonlyMap<string, LookState>,
): Map<string, Location> {
  const askers = askersByConsultant(people, lookStates);
  const meetingSeats = meetingSeatsOf(askers);
  const deskVisitors = deskVisitorsOf(askers, meetingSeats);
  const freeChillSeats = [...amenities.chillSeats];
  const locations = new Map<string, Location>();
  for (const person of people) {
    const desk = deskOf(layout, person.roleKey);
    if (!desk) continue;
    const location = locationFor(desk, {
      layout,
      amenities,
      lookState: lookStates.get(person.roleKey) ?? "idle",
      meetingSeat: meetingSeats.get(person.roleKey),
      visitedConsultant: deskVisitors.get(person.roleKey),
      takeChillSeat: () => freeChillSeats.shift() ?? null,
    });
    locations.set(person.roleKey, location);
  }
  return locations;
}

interface LocationContext {
  readonly layout: Layout;
  readonly amenities: Amenities;
  readonly lookState: LookState;
  readonly meetingSeat: number | undefined;
  /** The Consultant whose desk this person stands at, if they are its one visitor. */
  readonly visitedConsultant: string | undefined;
  readonly takeChillSeat: () => Seat | null;
}

function locationFor(desk: Desk, context: LocationContext): Location {
  const atDesk: Location = { kind: "desk", desk };
  const seatIndex = context.meetingSeat;
  const meetingSeat =
    seatIndex === undefined ? undefined : context.amenities.meetingSeats[seatIndex];
  if (seatIndex !== undefined && meetingSeat)
    return { kind: "meeting", seat: meetingSeat, seatIndex };
  switch (context.lookState) {
    case "consulting": {
      const consultantKey = context.visitedConsultant;
      const consultantDesk =
        consultantKey === undefined ? null : deskOf(context.layout, consultantKey);
      if (consultantKey === undefined || !consultantDesk) return atDesk;
      return { kind: "consult", consultantKey, desk: consultantDesk };
    }
    case "home":
      return { kind: "gone" };
    case "idle": {
      const seat = context.takeChillSeat();
      return seat ? { kind: "chill", seat } : atDesk;
    }
    default:
      return atDesk;
  }
}

/** Those standing at each Consultant's desk, asking them, in hire order. */
function visitorsByConsultant(locations: ReadonlyMap<string, Location>): Map<string, string[]> {
  const visitors = new Map<string, string[]>();
  for (const [roleKey, location] of locations) {
    if (location.kind !== "consult") continue;
    visitors.set(location.consultantKey, [
      ...(visitors.get(location.consultantKey) ?? []),
      roleKey,
    ]);
  }
  return visitors;
}

function deskActivity(lookState: LookState, visitorCount: number): DeskActivity {
  if (lookState === "waiting-on-you") return "waiting";
  if (visitorCount > 0) return "talking";
  if (lookState === "working") return "working";
  if (lookState === "asleep") return "asleep";
  return "idle";
}

/** Who talks with whom: a Consultant with those at their desk, or everyone at the meeting spot. */
function conversationsOf(
  locations: ReadonlyMap<string, Location>,
  visitors: ReadonlyMap<string, readonly string[]>,
): Map<string, readonly string[]> {
  const conversations = new Map<string, readonly string[]>();
  const meeting = [...locations]
    .filter(([, location]) => location.kind === "meeting")
    .toSorted(([, a], [, b]) => meetingSeatIndex(a) - meetingSeatIndex(b))
    .map(([roleKey]) => roleKey);
  if (meeting.length > 1) for (const roleKey of meeting) conversations.set(roleKey, meeting);
  for (const [consultantKey, visitorKeys] of visitors) {
    if (locations.get(consultantKey)?.kind !== "desk") continue;
    const talk = [consultantKey, ...visitorKeys];
    for (const roleKey of talk) conversations.set(roleKey, talk);
  }
  return conversations;
}

/** The meeting's turn order: the Consultant in seat 0 first. */
function meetingSeatIndex(location: Location): number {
  return location.kind === "meeting" ? location.seatIndex : 0;
}

interface Pose {
  readonly pose: FigurePose;
  readonly facing: Facing;
  readonly mirrored: boolean;
  readonly z: number;
}

const DESK_POSES: Record<DeskActivity, FigurePose> = {
  waiting: "sit-back-raise",
  asleep: "sit-back-sleep",
  // A Consultant turns their chair round to talk with whoever came to their desk.
  talking: "sit-front",
  working: "sit-back",
  idle: "sit-back",
};

function poseOf(location: Location, activity: DeskActivity | null): Pose {
  switch (location.kind) {
    case "desk": {
      const pose = DESK_POSES[activity ?? "idle"];
      return { pose, facing: pose === "sit-front" ? "front" : "back", mirrored: false, z: 0 };
    }
    case "consult":
      return { pose: "stand-back-talk", facing: "back", mirrored: false, z: 0 };
    case "meeting": {
      const front = location.seat.facing === "front";
      return {
        pose: front ? "sit-front" : "sit-back",
        facing: location.seat.facing,
        mirrored: true,
        z: 0,
      };
    }
    case "chill":
      if (location.seat.kind === "coffee") {
        return { pose: "stand-front-mug", facing: "front", mirrored: location.seat.mirrored, z: 0 };
      }
      return {
        pose: "sit-front",
        facing: "front",
        mirrored: location.seat.mirrored,
        z: location.seat.seatZ,
      };
    case "gone":
      return { pose: "stand-front", facing: "front", mirrored: false, z: 0 };
  }
}

function spotOf(location: Location): Spot {
  switch (location.kind) {
    case "desk":
      return deskSpot(location.desk);
    case "consult":
      return consultSpot(location.desk);
    case "meeting":
    case "chill":
      return location.seat;
    case "gone":
      return DOOR_OUTSIDE;
  }
}

/** Where a figure sorts: a seated one just in front of its desk or seat, else by its feet. */
function depthOf(location: Location, spot: Spot): number {
  switch (location.kind) {
    case "desk":
      return location.desk.depth + 0.1;
    case "meeting":
    case "chill":
      return location.seat.depth === null ? spot.x + spot.y : location.seat.depth + 0.1;
    default:
      return spot.x + spot.y;
  }
}

/**
 * Where each person is drawn and how, by Role key, straight from their look state: working, waiting
 * on you and asleep at the desk; consulting at the Consultant's desk, or at the meeting spot when two
 * or more ask one Consultant; idle in the chill area's seats in hire order, then at the desk; gone
 * home off the floor. People without a desk on the layout are left out.
 */
export function placementsOf(
  people: readonly OfficePerson[],
  layout: Layout,
  amenities: Amenities,
  light: Light,
  now: Date,
): ReadonlyMap<string, Placement> {
  const lookStates = lookStatesOf(people, now, light);
  const locations = locationsOf(people, layout, amenities, lookStates);
  const visitors = visitorsByConsultant(locations);
  const conversations = conversationsOf(locations, visitors);
  const placements = new Map<string, Placement>();
  for (const [roleKey, location] of locations) {
    const activity =
      location.kind === "desk"
        ? deskActivity(lookStates.get(roleKey) ?? "idle", visitors.get(roleKey)?.length ?? 0)
        : null;
    const spot = spotOf(location);
    placements.set(roleKey, {
      kind: location.kind,
      spot,
      ...poseOf(location, activity),
      depth: depthOf(location, spot),
      activity,
      conversation: conversations.get(roleKey) ?? null,
    });
  }
  return placements;
}

/* ---------- The desk's monitors ---------- */

export interface DeskMonitors {
  /** Monitors on the desk: a laptop for someone who only talks, else the Task limit up to three. */
  readonly shown: number;
  /** One lit for each running session, as many as are shown. */
  readonly lit: number;
  readonly laptop: boolean;
  /** "+N": monitors past three or sessions past those shown; lit while one of those runs. */
  readonly tag: { readonly count: number; readonly lit: boolean } | null;
}

export function monitorsOf(
  person: Pick<OfficePerson, "taskLimit" | "agents">,
  lookState: LookState,
): DeskMonitors {
  const laptop = person.taskLimit === "none";
  const limit = person.taskLimit === "none" ? 1 : person.taskLimit;
  const shown = laptop ? 1 : Math.min(3, Math.max(1, limit));
  const sessions = lookState === "home" ? 0 : person.agents.length;
  const extraMonitors = laptop ? 0 : Math.max(0, limit - 3);
  const extraLit = Math.max(0, sessions - shown);
  const count = Math.max(extraMonitors, extraLit);
  return {
    shown,
    lit: Math.min(sessions, shown),
    laptop,
    tag: count > 0 ? { count, lit: extraLit > 0 || sessions > 3 } : null,
  };
}

/* ---------- Words ---------- */

/** Role key → name, to name a Consultant or whoever asked a Consultation. */
export type PersonNames = ReadonlyMap<string, string>;

function quoted(title: string | undefined): string | null {
  return title === undefined ? null : `"${title}"`;
}

/** The record a Thread is on, by its title when the Work queries have it. */
function homeWords(home: Home, titles: RecordTitles): string {
  switch (home.kind) {
    case "task": {
      const title = quoted(titles.tasks.get(home.taskId));
      return title ? `the Task ${title}` : "a Task";
    }
    case "initiative": {
      const title = quoted(titles.initiatives.get(home.initiativeId));
      return title ? `the Initiative ${title}` : "an Initiative";
    }
    case "chat":
      return "a chat";
  }
}

function askerWords(askerRoleKey: string | null, names: PersonNames): string {
  if (askerRoleKey === null) return "The Office";
  return names.get(askerRoleKey) ?? "a colleague";
}

/** One running session, named by its Task or Initiative, or "a chat". */
export function agentWords(agent: LiveAgent, titles: RecordTitles, names: PersonNames): string {
  if (agent.kind === "consultation") {
    return `a Consultation for ${askerWords(agent.consultation?.askerRoleKey ?? null, names)}`;
  }
  const home = homeWords(agent.home, titles);
  return agent.kind === "stage" ? `a Stage of ${home}` : home;
}

/** "a, b and c". */
function listWords(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function capitalised(words: string): string {
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function consultantName(roleKey: string, names: PersonNames): string {
  return names.get(roleKey) ?? "a Consultant";
}

/** The state in words, as the tooltip, the popover and the list say it. */
export function stateWords(
  person: OfficePerson,
  lookState: LookState,
  titles: RecordTitles,
  names: PersonNames,
): string {
  const sessions = person.agents.map((agent) => agentWords(agent, titles, names));
  const alsoRunning = sessions.length ? `; still working on ${listWords(sessions)}` : "";
  switch (lookState) {
    case "waiting-on-you": {
      const asked = person.waitingOnYou[0];
      if (!asked) return `Waiting on you${alsoRunning}`;
      const what = asked.byTheOffice
        ? `a Stage of ${homeWords(asked.home, titles)} is out of tries`
        : `a Decision on ${homeWords(asked.home, titles)}`;
      return `Waiting on you: ${what}${alsoRunning}`;
    }
    case "consulting": {
      const asked = person.consulting[0];
      if (!asked) return `Asking a Consultant${alsoRunning}`;
      return `Asking ${consultantName(asked.consultantRoleKey, names)}: "${asked.question}"${alsoRunning}`;
    }
    case "working":
      return `Working on ${listWords(sessions)}`;
    case "joined":
      return "Just joined: at their new desk";
    case "asleep":
      return `Asleep at their desk: idle for ${ASLEEP_AFTER_MINUTES} minutes or more`;
    case "home":
      return "Gone home for the night";
    case "idle":
      return "Idle";
  }
}

function homeTarget(home: Home, threadId: string, decisionId: string | null): WorkTarget {
  switch (home.kind) {
    case "task":
      return { kind: "task", taskId: home.taskId, threadId, decisionId };
    case "initiative":
      return { kind: "initiative", initiativeId: home.initiativeId, threadId };
    case "chat":
      return { kind: "chat", roleKey: home.roleKey, threadId };
  }
}

/**
 * Their work, as links: each Decision waiting on you first, then each Decision they put to a
 * Consultant, then each running session's Thread. With none of those, their chat when their Role
 * has one and their page on People. A target already linked isn't linked twice.
 */
export function workLinksOf(
  person: OfficePerson,
  titles: RecordTitles,
  names: PersonNames,
): WorkLink[] {
  const links: WorkLink[] = [];
  const seen = new Set<string>();
  const add = (words: string, target: WorkTarget): void => {
    const key = JSON.stringify(target);
    if (seen.has(key)) return;
    seen.add(key);
    links.push({ words, target });
  };
  for (const asked of person.waitingOnYou) {
    const whose = asked.byTheOffice ? "The Office's Decision" : "Decision";
    add(
      `${whose} on ${homeWords(asked.home, titles)}: "${asked.question}"`,
      homeTarget(asked.home, asked.threadId, asked.decisionId),
    );
  }
  for (const asked of person.consulting) {
    add(
      `Put to ${consultantName(asked.consultantRoleKey, names)}: "${asked.question}"`,
      homeTarget(asked.home, asked.threadId, asked.decisionId),
    );
  }
  for (const agent of person.agents) {
    add(
      capitalised(agentWords(agent, titles, names)),
      homeTarget(agent.home, agent.threadId, null),
    );
  }
  if (links.length > 0) return links;
  if (person.chat)
    add(`Chat with ${person.name}`, { kind: "chat", roleKey: person.roleKey, threadId: null });
  add(`${person.name} on People`, { kind: "person", roleKey: person.roleKey });
  return links;
}

/** The list's groups, in its order, by the look state. */
export const LIST_GROUPS: readonly { readonly state: LookState; readonly words: string }[] = [
  { state: "waiting-on-you", words: "Waiting on you" },
  { state: "consulting", words: "Consulting" },
  { state: "working", words: "Working" },
  { state: "joined", words: "Just joined" },
  { state: "idle", words: "Idle" },
  { state: "asleep", words: "Asleep at their desk" },
  { state: "home", words: "Gone home" },
];

export const LOOK_STATE_ORDER: readonly LookState[] = LIST_GROUPS.map((group) => group.state);

/** The summary's counts, in its order; someone who just joined counts as idle. */
const SUMMARY_COUNTS: readonly { readonly states: readonly LookState[]; readonly words: string }[] =
  [
    { states: ["working"], words: "working" },
    { states: ["consulting"], words: "consulting" },
    { states: ["waiting-on-you"], words: "waiting on you" },
    { states: ["idle", "joined"], words: "idle" },
    { states: ["asleep"], words: "asleep" },
    { states: ["home"], words: "gone home" },
  ];

const PHASE_WORDS: Record<Light["phase"], string> = {
  day: "Day",
  dusk: "Dusk",
  night: "Night",
  dawn: "Dawn",
};

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

/** The time as HH:MM on a 24-hour clock, the same in every locale. */
function clockWords(now: Date): string {
  return `${twoDigits(now.getHours())}:${twoDigits(now.getMinutes())}`;
}

/** The canvas's label: "8 people: 4 working, 1 consulting, 1 waiting on you. Day, 13:05." */
export function summaryWords(
  people: readonly OfficePerson[],
  light: Light,
  now: Date,
  lookStates: ReadonlyMap<string, LookState>,
): string {
  const total = people.length;
  const counts = SUMMARY_COUNTS.map(({ states, words }) => ({
    count: people.filter((person) => states.includes(lookStates.get(person.roleKey) ?? "idle"))
      .length,
    words,
  }))
    .filter(({ count }) => count > 0)
    .map(({ count, words }) => `${count} ${words}`);
  const head = `${total} ${total === 1 ? "person" : "people"}`;
  const body = counts.length ? `${head}: ${counts.join(", ")}` : head;
  return `${body}. ${PHASE_WORDS[light.phase]}, ${clockWords(now)}.`;
}
