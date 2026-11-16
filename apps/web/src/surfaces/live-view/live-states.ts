import type { Home, LiveAgent } from "@the-office/contracts";
import { consultSpot, deskOf, deskSpot, DOOR_OUTSIDE } from "./floor-plan.ts";
import type {
  Amenities,
  Desk,
  DeskActivity,
  Exercise,
  Facing,
  FigurePose,
  IdleDoing,
  Layout,
  Light,
  LookState,
  OfficePerson,
  Phase,
  Placement,
  RecordTitles,
  Seat,
  Spot,
  SpotPastime,
  WorkLink,
  WorkTarget,
} from "./live-view-types.ts";
import { ASLEEP_AFTER_MINUTES, type PastimeTurn, pastimeTurnOf } from "./pastimes.ts";

/** How long "New" shows on a hire's nameplate. */
export const NEW_FOR_MINUTES = 60;

const MINUTE = 60_000;

/** Within the first hour after they were hired. */
export function isNewHire(person: Pick<OfficePerson, "hiredAt">, now: Date): boolean {
  return now.getTime() - Date.parse(person.hiredAt) < NEW_FOR_MINUTES * MINUTE;
}

/**
 * What the figure shows: the snapshot's headline, with idle split by who just joined, who went home
 * for the night and who picked a nap for this turn (`pastimes.ts`). A nap is picked only 30 minutes
 * or more after they fell idle, counted from dawn at the latest, so those who walk back in at dawn
 * go to a pastime first (design decision 12); the words still count from `idleSince`.
 */
export function lookStateOf(person: OfficePerson, now: Date, light: Light): LookState {
  if (person.state !== "idle") return person.state;
  if (isNewHire(person, now)) return "joined";
  if (light.phase === "night") return "home";
  return pastimeTurnOf(person, now, light).pastime === "nap" ? "asleep" : "idle";
}

/**
 * What an idle person picked for this turn, as the words say it before the floor has placed them:
 * the floor's own answer (`doingsOf`) differs only when their pick's spots were all taken.
 */
export function pickedDoingOf(person: OfficePerson, now: Date, light: Light): IdleDoing {
  const turn = pastimeTurnOf(person, now, light);
  return {
    pastime: turn.pastime,
    exercise: turn.pastime === "exercise" ? turn.exercise : null,
    chatting: false,
  };
}

/** The light last given to the floor, and when. */
export interface SeenLight {
  readonly light: Light;
  readonly at: Date;
}

/** Longer than this between two lights, the tab was hidden or the machine slept. */
const LIVE_LIGHT_GAP_MINUTES = 2;

/**
 * Whether people walk out or in for this light: only when night begins or ends in front of the
 * viewer. After a hidden tab or a sleeping machine they are put in place, so a whole office doesn't
 * walk at once when the tab shows again.
 */
export function walksAtLightChange(previous: SeenLight | null, light: Light, now: Date): boolean {
  if (previous === null) return false;
  if (now.getTime() - previous.at.getTime() >= LIVE_LIGHT_GAP_MINUTES * MINUTE) return false;
  return (previous.light.phase === "night") !== (light.phase === "night");
}

/** Whether the fire alarm was on when the floor was last given it, and when. */
export interface SeenAlarm {
  readonly on: boolean;
  readonly at: Date;
}

/**
 * Whether the fire alarm's sounding or all clear walks people (out in a panic, or back in): only when
 * it changes in front of the viewer, the floor given it less than 2 minutes before. The caller also
 * checks the tab is visible, as a hidden tab still applies. Otherwise everyone is put out, or back,
 * in place at once.
 */
export function walksAtAlarmChange(
  previous: SeenAlarm | null,
  alarmOn: boolean,
  now: Date,
): boolean {
  if (previous === null) return false;
  if (now.getTime() - previous.at.getTime() >= LIVE_LIGHT_GAP_MINUTES * MINUTE) return false;
  return previous.on !== alarmOn;
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
  | {
      readonly kind: "pastime";
      readonly seat: Seat;
      readonly exercise: Exercise;
    }
  | { readonly kind: "gone" };

/** Each pastime's spots on the floor, taken one by one in their order; nobody shares a spot. */
class FreeSpots {
  private readonly free = new Map<SpotPastime, Seat[]>();

  constructor(spots: readonly Seat[]) {
    for (const spot of spots) {
      this.free.set(spot.kind, [...(this.free.get(spot.kind) ?? []), spot]);
    }
  }

  /** The first free spot of the first pastime in the turn's order with one left; null for the desk. */
  take(turn: PastimeTurn): Location | null {
    for (const pastime of turn.preferences) {
      const seat = this.free.get(pastime)?.shift();
      if (seat !== undefined) return { kind: "pastime", seat, exercise: turn.exercise };
    }
    return null;
  }
}

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
 * The one asker who stands at each Consultant's desk: the first, in hire order. Anyone else asking
 * the same Consultant waits at their own desk, so no two figures share one spot.
 */
function deskVisitorsOf(askers: ReadonlyMap<string, readonly string[]>): Map<string, string> {
  const visitors = new Map<string, string>();
  for (const [consultantKey, keys] of askers) {
    const first = keys[0];
    if (first !== undefined) visitors.set(first, consultantKey);
  }
  return visitors;
}

function locationsOf(
  people: readonly OfficePerson[],
  layout: Layout,
  amenities: Amenities,
  lookStates: ReadonlyMap<string, LookState>,
  turnOf: (person: OfficePerson) => PastimeTurn,
  alarmOn: boolean,
): Map<string, Location> {
  const askers = askersByConsultant(people, lookStates);
  const deskVisitors = deskVisitorsOf(askers);
  const freeSpots = new FreeSpots(amenities.pastimeSpots);
  const locations = new Map<string, Location>();
  for (const person of people) {
    const desk = deskOf(layout, person.roleKey);
    if (!desk) continue;
    // The fire alarm empties the floor: everyone is out, their desk kept.
    if (alarmOn) {
      locations.set(person.roleKey, { kind: "gone" });
      continue;
    }
    const location = locationFor(desk, {
      layout,
      lookState: lookStates.get(person.roleKey) ?? "idle",
      visitedConsultant: deskVisitors.get(person.roleKey),
      takePastimeSpot: () => freeSpots.take(turnOf(person)),
    });
    locations.set(person.roleKey, location);
  }
  return locations;
}

interface LocationContext {
  readonly layout: Layout;
  readonly lookState: LookState;
  /** The Consultant whose desk this person stands at, if they are its one visitor. */
  readonly visitedConsultant: string | undefined;
  /** A spot of this turn's pastime, or of the next in their order with one free; null for the desk. */
  readonly takePastimeSpot: () => Location | null;
}

function locationFor(desk: Desk, context: LocationContext): Location {
  const atDesk: Location = { kind: "desk", desk };
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
    case "idle":
      return context.takePastimeSpot() ?? atDesk;
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

/** What someone at their desk does, by their look state and how many stand at their desk asking. */
export function deskActivity(lookState: LookState, visitorCount: number): DeskActivity {
  if (lookState === "waiting-on-you") return "waiting";
  if (visitorCount > 0) return "talking";
  if (lookState === "working") return "working";
  if (lookState === "asleep") return "asleep";
  return "idle";
}

/**
 * Who talks with whom: a Consultant with the one at their desk, and everyone on the sofa, two or
 * more, from its left seat to its right.
 */
function conversationsOf(
  locations: ReadonlyMap<string, Location>,
  visitors: ReadonlyMap<string, readonly string[]>,
): Map<string, readonly string[]> {
  const conversations = new Map<string, readonly string[]>();
  const sofa = [...locations]
    .filter(([, location]) => location.kind === "pastime" && location.seat.kind === "sofa")
    .toSorted(([, a], [, b]) => sofaSeatX(a) - sofaSeatX(b))
    .map(([roleKey]) => roleKey);
  if (sofa.length > 1) for (const roleKey of sofa) conversations.set(roleKey, sofa);
  for (const [consultantKey, visitorKeys] of visitors) {
    if (locations.get(consultantKey)?.kind !== "desk") continue;
    const talk = [consultantKey, ...visitorKeys];
    for (const roleKey of talk) conversations.set(roleKey, talk);
  }
  return conversations;
}

function sofaSeatX(location: Location): number {
  return location.kind === "pastime" ? location.seat.x : 0;
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
  // Idle at the desk, sitting back and stretching now and then.
  idle: "sit-back-stretch",
};

const EXERCISE_POSES: Record<Exercise, FigurePose> = {
  "jumping-jacks": "stand-front-jacks",
  squats: "stand-front-squat",
  "push-ups": "lie-front-push-up",
};

/** Each pastime's pose at its spot. */
function pastimePoseOf(pastime: SpotPastime, exercise: Exercise): FigurePose {
  switch (pastime) {
    case "coffee":
      return "stand-front-mug";
    case "water":
      return "stand-front-cup";
    case "sofa":
      return "sit-front";
    case "beanbag":
      return "sit-front-phone";
    case "exercise":
      return EXERCISE_POSES[exercise];
    case "bookshelf":
      return "stand-back-read";
    case "plant":
      return "stand-back-water";
    case "games":
      return "sit-back-play";
  }
}

/** The pose at a desk: turned round to talk, else facing the monitors. */
export function deskPoseOf(activity: DeskActivity): FigurePose {
  return DESK_POSES[activity];
}

function poseOf(location: Location, activity: DeskActivity | null): Pose {
  switch (location.kind) {
    case "desk": {
      const pose = deskPoseOf(activity ?? "idle");
      return { pose, facing: pose === "sit-front" ? "front" : "back", mirrored: false, z: 0 };
    }
    case "consult":
      return { pose: "stand-back-talk", facing: "back", mirrored: false, z: 0 };
    case "pastime":
      return {
        pose: pastimePoseOf(location.seat.kind, location.exercise),
        facing: location.seat.facing,
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
    case "pastime":
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
    case "pastime":
      return location.seat.depth === null ? spot.x + spot.y : location.seat.depth + 0.1;
    default:
      return spot.x + spot.y;
  }
}

/** What an idle or napping person is doing where the floor put them; null for anyone else. */
function doingOf(
  location: Location,
  lookState: LookState,
  conversation: readonly string[] | null,
): IdleDoing | null {
  if (location.kind === "pastime") {
    const pastime = location.seat.kind;
    return {
      pastime,
      exercise: pastime === "exercise" ? location.exercise : null,
      chatting: conversation !== null,
    };
  }
  if (location.kind !== "desk") return null;
  if (lookState === "asleep") return { pastime: "nap", exercise: null, chatting: false };
  if (lookState === "idle") return { pastime: "desk", exercise: null, chatting: false };
  return null;
}

/**
 * Where each person is drawn and how, by Role key, straight from their look state: working, waiting
 * on you and napping at the desk; consulting at the Consultant's desk, the first of two or more
 * asking one Consultant, the rest at their own desks; idle at a spot of this turn's pastime, in hire
 * order, else of the next in their own order with one free, else at the desk; gone home off the
 * floor; while the fire alarm is on, everyone off the floor. People without a desk on the layout are
 * left out.
 */
export function placementsOf(
  people: readonly OfficePerson[],
  layout: Layout,
  amenities: Amenities,
  light: Light,
  now: Date,
  alarmOn = false,
): ReadonlyMap<string, Placement> {
  const lookStates = lookStatesOf(people, now, light);
  const locations = locationsOf(
    people,
    layout,
    amenities,
    lookStates,
    (person) => pastimeTurnOf(person, now, light),
    alarmOn,
  );
  const visitors = visitorsByConsultant(locations);
  const conversations = conversationsOf(locations, visitors);
  const placements = new Map<string, Placement>();
  for (const [roleKey, location] of locations) {
    const lookState = lookStates.get(roleKey) ?? "idle";
    const activity =
      location.kind === "desk" ? deskActivity(lookState, visitors.get(roleKey)?.length ?? 0) : null;
    const spot = spotOf(location);
    const conversation = conversations.get(roleKey) ?? null;
    placements.set(roleKey, {
      kind: location.kind,
      spot,
      ...poseOf(location, activity),
      depth: depthOf(location, spot),
      activity,
      consultantKey: location.kind === "consult" ? location.consultantKey : null,
      conversation,
      doing: doingOf(location, lookState, conversation),
    });
  }
  return placements;
}

/** What each idle person on the floor is doing, by Role key, from their placements. */
export function doingsOf(placements: ReadonlyMap<string, Placement>): Map<string, IdleDoing> {
  const doings = new Map<string, IdleDoing>();
  for (const [roleKey, placement] of placements) {
    if (placement.doing) doings.set(roleKey, placement.doing);
  }
  return doings;
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

const EXERCISE_WORDS: Record<Exercise, string> = {
  "jumping-jacks": "doing jumping jacks",
  squats: "doing squats",
  "push-ups": "doing push-ups",
};

/** What an idle person is doing, as "Idle: …" goes on: "having a coffee". */
export function doingWords(doing: IdleDoing): string {
  switch (doing.pastime) {
    case "coffee":
      return "having a coffee";
    case "water":
      return "having a cup of water";
    case "sofa":
      return doing.chatting ? "chatting on the sofa" : "relaxing on the sofa";
    case "beanbag":
      return "on their phone in a beanbag";
    case "exercise":
      return EXERCISE_WORDS[doing.exercise ?? "jumping-jacks"];
    case "bookshelf":
      return "browsing the bookshelf";
    case "plant":
      return "watering a plant";
    case "games":
      return "playing games";
    case "nap":
      return "napping at their desk";
    case "desk":
      return "stretching at their desk";
  }
}

/**
 * The state in words, as the tooltip, the popover and the list say it; `doing` says what an idle
 * person is doing.
 */
export function stateWords(
  person: OfficePerson,
  lookState: LookState,
  titles: RecordTitles,
  names: PersonNames,
  doing: IdleDoing | null = null,
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
      return "Gone home for the night: idle";
    case "idle":
      return doing ? `Idle: ${doingWords(doing)}` : "Idle";
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

export const PHASE_WORDS: Readonly<Record<Phase, string>> = {
  day: "Day",
  dusk: "Dusk",
  night: "Night",
  dawn: "Dawn",
};

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

/** Minutes after midnight as HH:MM on a 24-hour clock, the same in every locale. */
export function clockWords(minutes: number): string {
  const whole = ((Math.floor(minutes) % 1440) + 1440) % 1440;
  return `${twoDigits(Math.floor(whole / 60))}:${twoDigits(whole % 60)}`;
}

/**
 * The canvas's label: "8 people: 2 working, 1 waiting on you, 5 gone home. Night, 22:30."; while the
 * fire alarm is on, "8 people: the fire alarm is on, everyone is out of the office. Day, 10:00."
 */
export function summaryWords(
  people: readonly OfficePerson[],
  light: Light,
  lookStates: ReadonlyMap<string, LookState>,
  alarmOn = false,
): string {
  const total = people.length;
  const when = `${PHASE_WORDS[light.phase]}, ${clockWords(light.minutes)}.`;
  if (alarmOn) {
    const head = `${total} ${total === 1 ? "person" : "people"}`;
    const out = total === 0 ? "nobody is in the office" : "everyone is out of the office";
    return `${head}: the fire alarm is on, ${out}. ${when}`;
  }
  const counts = SUMMARY_COUNTS.map(({ states, words }) => ({
    count: people.filter((person) => states.includes(lookStates.get(person.roleKey) ?? "idle"))
      .length,
    words,
  }))
    .filter(({ count }) => count > 0)
    .map(({ count, words }) => `${count} ${words}`);
  const head = `${total} ${total === 1 ? "person" : "people"}`;
  const body = counts.length ? `${head}: ${counts.join(", ")}` : head;
  return `${body}. ${when}`;
}
