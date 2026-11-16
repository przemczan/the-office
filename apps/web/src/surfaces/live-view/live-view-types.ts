import type { Image, LivePerson, TaskLimit } from "@the-office/contracts";

/** A person of the Live view snapshot, joined with what their Role gives. */
export interface OfficePerson extends LivePerson {
  readonly taskLimit: TaskLimit;
  readonly consultant: boolean;
  readonly chat: boolean;
  readonly hiredAt: string;
  readonly avatar: Image | null;
}

/**
 * What the figure shows, which the list and the words follow too: the snapshot's headline, with
 * idle split by how long and whether the person just joined. `home` is reached only at night.
 */
export type LookState =
  "working" | "consulting" | "waiting-on-you" | "idle" | "asleep" | "joined" | "home";

/** The part of the day: night before civil dawn and after civil dusk (design decision 11). */
export type Phase = "day" | "dusk" | "night" | "dawn";

/** The sky in the windows, by the sun's height: a key of `SKY_PALETTES`. */
export type Sky = "day" | "golden" | "dawn" | "dusk" | "night";

/** A place on Earth, in degrees: north and east are positive. */
export interface Place {
  readonly latitude: number;
  readonly longitude: number;
}

/** Today in a time zone, with the sun's times in minutes after local midnight. */
export interface SunDay extends Place {
  readonly timeZone: string;
  readonly date: { readonly year: number; readonly month: number; readonly day: number };
  /** How far the zone is ahead of UTC today, in minutes. */
  readonly offset: number;
  readonly noon: number;
  /** Set when the sun never sets ("day") or never rises ("night") today; the times are then null. */
  readonly polar: "day" | "night" | null;
  readonly sunrise: number | null;
  readonly sunset: number | null;
  /** When the sun is 6° below the horizon; sunrise and sunset in a white night. */
  readonly civilDawn: number | null;
  readonly civilDusk: number | null;
}

/** The hour's light, from the sun's height at the browser's time zone. */
export interface Light {
  readonly phase: Phase;
  /** `0xRRGGBB`, as a sprite's `tint`. */
  readonly tint: number;
  /** Dark enough for desk lamps, at dusk too. */
  readonly lampsOn: boolean;
  /** How strongly screens, lamps and signs glow, 0 to 1. */
  readonly glow: number;
  readonly sky: Sky;
  /** Sunlight on the floor under the windows while the sun is above 2°. */
  readonly sunPatch: { readonly color: number; readonly alpha: number } | null;
  /** The sun's height, in degrees. */
  readonly elevation: number;
  /** Minutes after local midnight. */
  readonly minutes: number;
  /** Epoch ms of today's civil dawn; null in a polar day or night and without a place. */
  readonly dawnAt: number | null;
  /** Today's sun, or null when the browser's time zone has no place (noon's light all day). */
  readonly sun: SunDay | null;
}

/** Who a desk's group is, from the Role card (design decision 5). */
export type DeskGroup = "front-desk" | "consultants" | "team";

/** A point on the floor, in tiles. */
export interface FloorPoint {
  readonly x: number;
  readonly y: number;
}

/** Where a figure stands or sits, the tile it is reached from and a step out between. */
export interface Spot extends FloorPoint {
  readonly tile?: FloorPoint;
  readonly exit?: FloorPoint;
}

/** A column of pods on the floor, holding one group's desks. */
export interface PodColumn {
  readonly group: DeskGroup;
  readonly x: number;
}

/** A desk; `roleKey` null once the person was let go, until a hire of the group takes it. */
export interface Desk {
  roleKey: string | null;
  /** Who sat here before they were let go: their chair is pushed in and their monitors dark. */
  formerKey: string | null;
  readonly group: DeskGroup;
  readonly column: PodColumn;
  readonly slot: number;
  readonly x: number;
  readonly y: number;
  /** Sort depth: x + y of its front corner. */
  readonly depth: number;
}

/** The floor plan, laid out once per page open and grown by hires. */
export interface Layout {
  readonly perPod: number;
  readonly rows: number;
  readonly columns: PodColumn[];
  readonly desks: Desk[];
  readonly sofaSeats: number;
  readonly beanbags: number;
  readonly chillStart: number;
  readonly chillEnd: number;
  /** Tiles from the back wall to the front. */
  readonly depth: number;
  /** Tiles from the left wall to the right; grows when a hire opens a pod at the right end. */
  width: number;
}

export type Facing = "front" | "back";

/**
 * What an idle person does for a turn of 4 to 8 minutes (`pastimes.ts`). `desk` is never picked: it
 * is where they sit, stretching now and then, when every spot they would pick is taken.
 */
export type Pastime =
  "coffee" | "water" | "sofa" | "beanbag" | "exercise" | "bookshelf" | "plant" | "nap" | "desk";

/** A pastime done at a spot of its own on the floor, rather than at the desk. */
export type SpotPastime = Exclude<Pastime, "nap" | "desk">;

/** What someone on the exercise mat does, picked by the turn's seed. */
export type Exercise = "jumping-jacks" | "squats" | "push-ups";

/** What an idle person is doing, as the words say it. */
export interface IdleDoing {
  readonly pastime: Pastime;
  /** On the exercise mat: which exercise; else null. */
  readonly exercise: Exercise | null;
  /** On the sofa with someone else, chatting. */
  readonly chatting: boolean;
}

/** A seat at the meeting spot, or a pastime's spot: a seat, or a place to stand. */
export interface Seat extends Spot {
  readonly kind: "meeting" | SpotPastime;
  readonly tile: FloorPoint;
  readonly facing: Facing;
  readonly mirrored: boolean;
  /** Sort depth, or null to sort by the feet. */
  readonly depth: number | null;
  /** How high the seat lifts the figure, in art pixels. */
  readonly seatZ: number;
  /** The meeting chairs' back, on the side away from the table. */
  readonly chairBack?: "-y" | "+y";
}

export type AmenityKind =
  | "meetingTable"
  | "plant"
  | "sofa"
  | "coffeeMachine"
  | "waterCooler"
  | "coffeeTable"
  | "beanbag"
  | "bookshelf"
  | "printer"
  | "exerciseMat";

/** A piece of furniture along the back wall, with what its shape needs. */
export interface Amenity extends FloorPoint {
  readonly kind: AmenityKind;
  readonly depth: number;
  readonly tall?: boolean;
  readonly seats?: number;
  readonly width?: number;
  readonly seed?: number;
  /** Which of the beanbags' colours, from 0. */
  readonly variant?: number;
}

/** The meeting spot, the chill area and the furniture along the back wall, with their seats. */
export interface Amenities {
  readonly items: readonly Amenity[];
  /** Tiles furniture stands on, `[x, y]`; the exercise mat, flat on the floor, blocks none. */
  readonly blocked: readonly (readonly [number, number])[];
  readonly meetingSeats: readonly Seat[];
  /** Every pastime's spots, each pastime's in the order they are taken. */
  readonly pastimeSpots: readonly Seat[];
}

/**
 * A figure's pose, by the art's names. New poses are appended: `stand`/`sit`/`walk`/`lie` say how
 * the figure is held, `front`/`back` which way it faces.
 */
export type FigurePose =
  | "stand-front"
  | "stand-back"
  | "stand-front-mug"
  | "stand-back-talk"
  | "sit-back"
  | "sit-back-raise"
  | "sit-back-sleep"
  | "sit-front"
  | "walk-front"
  | "walk-back"
  /** Water at the cooler: a paper cup in hand. */
  | "stand-front-cup"
  /** On a beanbag, looking down at a phone held in both hands; one frame. */
  | "sit-front-phone"
  /** On the mat, jumping jacks: frame 0 arms up and feet apart, frame 1 arms down and feet together. */
  | "stand-front-jacks"
  /** On the mat, squats: frame 0 down, knees bent and arms out in front, frame 1 standing. */
  | "stand-front-squat"
  /**
   * On the mat, a push-up: lying face down along the floor's y axis, head up and to the right, its
   * anchor the middle of the body; frame 0 arms straight and the body up, frame 1 arms bent and low.
   */
  | "lie-front-push-up"
  /** At a bookshelf, back to us, holding an open book up: frame 1 turns a page. */
  | "stand-back-read"
  /** At a plant, back to us, a watering can in hand: frame 1 tips it, a drop or two falling. */
  | "stand-back-water"
  /** Idle at the desk, sitting back: frame 0 at rest, frame 1 stretches, arms up over the head. */
  | "sit-back-stretch";

/** What someone at their desk is doing, for the pose and what is drawn over them. */
export type DeskActivity = "working" | "waiting" | "talking" | "asleep" | "idle";

/** Where a figure is drawn and how, worked out from their look state and nobody's movement. */
export interface Placement {
  readonly kind: "desk" | "consult" | "meeting" | "pastime" | "gone";
  readonly spot: Spot;
  readonly pose: FigurePose;
  readonly facing: Facing;
  readonly mirrored: boolean;
  /** How high a seat lifts the figure, in art pixels. */
  readonly z: number;
  /** Sort depth among the floor's sprites. */
  readonly depth: number;
  /** At a desk: what they do there. */
  readonly activity: DeskActivity | null;
  /** At a `consult` placement: the Consultant whose desk they stand at. */
  readonly consultantKey: string | null;
  /** Everyone in the same talk, in turn order, this person included; null when not talking. */
  readonly conversation: readonly string[] | null;
  /** What an idle person is doing, wherever they are; null for anyone not idle. */
  readonly doing: IdleDoing | null;
}

/** Task and Initiative titles by id, from the web's Work queries, to name each running session. */
export interface RecordTitles {
  readonly tasks: ReadonlyMap<string, string>;
  readonly initiatives: ReadonlyMap<string, string>;
}

/** Where a click on someone takes the user. */
export type WorkTarget =
  | {
      readonly kind: "task";
      readonly taskId: string;
      readonly threadId: string;
      readonly decisionId: string | null;
    }
  | { readonly kind: "initiative"; readonly initiativeId: string; readonly threadId: string }
  | { readonly kind: "chat"; readonly roleKey: string; readonly threadId: string | null }
  | { readonly kind: "person"; readonly roleKey: string };

/** One of someone's pieces of work, as the popover and the list link it. */
export interface WorkLink {
  readonly words: string;
  readonly target: WorkTarget;
}

/** Where a figure is on the canvas, in CSS pixels from its top left, to place its nameplate. */
export interface FigureAnchor {
  readonly roleKey: string;
  /** The figure's middle. */
  readonly x: number;
  /** Over its head. */
  readonly top: number;
  /** Just under its feet, where the nameplate goes. */
  readonly bottom: number;
  /** Past the door, seen only through the doorway: its nameplate is hidden. */
  readonly outside: boolean;
  /** Let go and walking out: named, but nothing to open. */
  readonly leaving: boolean;
}

/** What the page shows over the floor: the zoom and where each figure is. */
export interface StageView {
  /** CSS pixels per art pixel. */
  readonly scale: number;
  readonly zoomPercent: number;
  readonly canZoomIn: boolean;
  readonly canZoomOut: boolean;
  readonly anchors: readonly FigureAnchor[];
  /** What each idle person on the floor is doing, by Role key, as the words say it. */
  readonly doings: ReadonlyMap<string, IdleDoing>;
}

export interface OfficeStageOptions {
  /** The still office: no ticker, drawn again only when something changes. */
  readonly reducedMotion: boolean;
  readonly onView: (view: StageView) => void;
  /** The figure under the pointer, or null. */
  readonly onHover: (roleKey: string | null) => void;
  /** A press on a figure; `pointerType` as the PointerEvent gives it, "touch" for a tap. */
  readonly onPress: (roleKey: string, pointerType: string) => void;
  /**
   * A walking figure moved: where its nameplate goes, in CSS pixels as `FigureAnchor`'s `x` and
   * `bottom`. Called each frame for each figure on the move, so it writes to the DOM, not to state.
   */
  readonly onFigureMove: (roleKey: string, x: number, bottom: number, outside: boolean) => void;
}

/** The PixiJS floor, which the page loads only through a dynamic import. */
export interface OfficeStage {
  /**
   * Draws a snapshot: hires take a desk and walk in, those let go walk out leaving an empty one,
   * everyone else walks where their state puts them; under the still office every move is a jump.
   */
  apply(people: readonly OfficePerson[], now: Date): void;
  /**
   * The hour's light; given before the first `apply`, then each minute. With motion the tint fades
   * over 2 s, and people walk out or in only when night begins or ends in front of the viewer
   * (`walksAtLightChange`); otherwise they are put in place at once.
   */
  setLight(light: Light, now: Date): void;
  /** Frames a figure and rings it for a moment (Show on the floor). */
  frame(roleKey: string): void;
  zoomStep(direction: 1 | -1): void;
  /** Fits the whole office. */
  fit(): void;
  /** After the canvas's box changed size. */
  resize(): void;
  destroy(): void;
}

/** Rejects when PixiJS can't start, as without WebGL. */
export type CreateOfficeStage = (
  canvas: HTMLCanvasElement,
  options: OfficeStageOptions,
) => Promise<OfficeStage>;
