import { Container, Graphics, Sprite, Texture } from "pixi.js";
import { paintedFigure, seedOf } from "./art/figures.ts";
import { paintFloorLayer, paintSunPatches, paintWalls } from "./art/floor-art.ts";
import {
  beanbagShape,
  bookshelfShape,
  chairBackShape,
  chairSeatShape,
  coffeeMachineShape,
  coffeeTableShape,
  deskShape,
  doorShape,
  lampShape,
  meetingTableShape,
  monitorSlots,
  pizzaShape,
  plantShape,
  printerShape,
  screenShape,
  sofaShape,
  waterCoolerShape,
} from "./art/furniture.ts";
import { DESK_H, isoX, isoY } from "./art/iso.ts";
import {
  bubbleShape,
  paintedOverlay,
  signShape,
  sparkleShape,
  tagShape,
  zShape,
} from "./art/overlays.ts";
import {
  ART_COLORS,
  ART_PALETTE,
  type AvatarTone,
  SKY_PALETTES,
  artPalette,
  avatarTone,
  paintedOfficeArt,
} from "./art/palettes.ts";
import { type PaintedArt, PixelGrid, isoPen, paintGrid } from "./art/pixel-grid.ts";
import type { FigureHitBox } from "./figure-hit.ts";
import { AISLE_ROW, deskOf, deskSpot, pushedInSpot } from "./floor-plan.ts";
import type {
  Amenities,
  Amenity,
  Desk,
  DeskActivity,
  FigurePose,
  FloorPoint,
  Layout,
  Light,
  LookState,
  OfficePerson,
  Placement,
  Sky,
} from "./live-view-types.ts";
import { deskActivity, deskPoseOf, monitorsOf } from "./live-states.ts";
import { type OfficeGeometry, toArt } from "./office-geometry.ts";
import { type StageTextures, artSprite, setArt, showArt } from "./stage-textures.ts";
import type { Walker, Walkers } from "./walkers.ts";

/** What one drawing of the office is made of: the floor plan, the people and their walkers, at the hour's light. */
export interface SceneInput {
  readonly layout: Layout;
  readonly amenities: Amenities;
  readonly geometry: OfficeGeometry;
  readonly people: ReadonlyMap<string, OfficePerson>;
  readonly lookStates: ReadonlyMap<string, LookState>;
  readonly walkers: Walkers;
  readonly light: Light;
}

/** A figure on the floor for hit-testing and its nameplate, moved in place as it walks. */
export interface PlacedFigure extends FigureHitBox {
  /** Its feet, in art pixels. */
  readonly feet: { x: number; y: number };
  depth: number;
  seated: boolean;
  /** Let go and on the way out: drawn and named, but not pressed. */
  readonly leaving: boolean;
  /** Past the door, seen only through the doorway; its nameplate is hidden. */
  outside: boolean;
  /** Gone out of the door and settled there: neither pressed nor anchoring a nameplate. */
  readonly gone: boolean;
}

/** Moves a sprite's look on with the animation clock `t` (seconds); `motion` false draws the still office. */
type Animation = (t: number, motion: boolean) => void;

interface DeskLook {
  readonly shown: number;
  readonly laptop: boolean;
}

/** A figure's sprite and what it last showed, so a walking frame changes only what moved. */
interface Actor {
  readonly sprite: Sprite;
  tone: AvatarTone;
  place: PlacedFigure | null;
  pose: FigurePose;
  frame: number;
}

const SPEAKING_TURN_SECONDS = 1.8;
const RING_GRID = { width: 27, height: 15, anchorX: 13, anchorY: 7 } as const;
/** Outside the room past this x, a figure shows only through the doorway. */
const INSIDE_FROM_X = 0.1;
/** The doorway's opening on the left wall, in tiles along it and pixels up. */
const DOORWAY = { from: AISLE_ROW + 0.16, to: AISLE_ROW + 0.84, height: 33 } as const;
/**
 * The door's sort depth. The doorway's figures are drawn just over it: the open door is a dark
 * opening, and someone outside shows against it, clipped to it.
 */
const DOOR_DEPTH = AISLE_ROW + 0.3;
const SPARKLES_PER_DESK = 4;
/** The desk lamp's bulb, in art pixels: three wide, one high, lit (untinted). */
const BULB = { width: 3, height: 1 } as const;

/** What glows in the dark (design decision 13): its colour and its rings, each a radius and an alpha. */
const GLOWS = {
  monitor: {
    color: 0x6fb6ff,
    rings: [
      [13, 0.05],
      [8, 0.07],
      [4, 0.08],
    ],
  },
  lamp: {
    color: 0xffcf80,
    rings: [
      [22, 0.06],
      [14, 0.09],
      [8, 0.12],
    ],
  },
  led: { color: 0xff6a4a, rings: [[3, 0.12]] },
  exitSign: { color: 0x2fbf71, rings: [[6, 0.1]] },
} as const satisfies Record<
  string,
  { readonly color: number; readonly rings: readonly (readonly [number, number])[] }
>;
type GlowKind = keyof typeof GLOWS;

/** A glow's flat ellipses, twice as wide as high, centred on its anchor; drawn added to what is under it. */
function paintGlow(kind: GlowKind): PaintedArt {
  const { color, rings } = GLOWS[kind];
  const radius = Math.max(...rings.map(([ringRadius]) => ringRadius));
  const anchorX = radius + 1;
  const anchorY = Math.ceil(radius / 2) + 1;
  const canvas = document.createElement("canvas");
  canvas.width = anchorX * 2;
  canvas.height = anchorY * 2;
  const context = canvas.getContext("2d");
  if (context) {
    context.globalCompositeOperation = "lighter";
    const rgb = `${(color >> 16) & 0xff}, ${(color >> 8) & 0xff}, ${color & 0xff}`;
    for (const [ringRadius, alpha] of rings) {
      context.fillStyle = `rgba(${rgb}, ${alpha})`;
      context.beginPath();
      context.ellipse(anchorX, anchorY, ringRadius, ringRadius / 2, 0, 0, Math.PI * 2);
      context.fill();
    }
  }
  return { canvas, anchorX, anchorY };
}

/** Whose turn it is to speak in a conversation; in the still office everyone in it shows a bubble. */
function isSpeaking(
  talk: readonly string[] | undefined,
  roleKey: string,
  t: number,
  motion: boolean,
): boolean {
  if (!talk || talk.length === 0) return false;
  if (!motion) return true;
  return talk[Math.floor(t / SPEAKING_TURN_SECONDS) % talk.length] === roleKey;
}

/** The pose's frame at `t`: typing, the raised hand, sleep's breathing and talking, each at its own rate. */
function frameOf(
  pose: FigurePose,
  activity: DeskActivity | null,
  roleKey: string,
  t: number,
  motion: boolean,
  speaking: boolean,
): number {
  const tick = (rate: number, offset = 0): number => (motion ? Math.floor(t * rate + offset) : 0);
  const offset = (seedOf(roleKey) % 10) / 10;
  switch (pose) {
    case "sit-back-raise":
      return tick(1.6) % 2;
    case "sit-back-sleep":
      return tick(0.7, offset) % 2;
    case "sit-back":
      return activity === "working" ? tick(5, offset * 3) % 2 : 0;
    case "sit-front":
    case "stand-back-talk":
      return speaking ? tick(3) % 2 : 0;
    default:
      return 0;
  }
}

function amenityArt(item: Amenity): PaintedArt | null {
  switch (item.kind) {
    case "meetingTable":
      return paintedOfficeArt("meetingTable", meetingTableShape);
    case "sofa": {
      const seats = item.seats ?? 3;
      return paintedOfficeArt(`sofa:${seats}`, () => sofaShape(seats));
    }
    case "coffeeMachine":
      return paintedOfficeArt("coffeeMachine", coffeeMachineShape);
    case "waterCooler":
      return paintedOfficeArt("waterCooler", waterCoolerShape);
    case "coffeeTable": {
      const width = item.width ?? 1;
      return paintedOfficeArt(`coffeeTable:${width}`, () => coffeeTableShape(width));
    }
    case "beanbag": {
      const variant = item.variant ?? 0;
      return paintedOfficeArt(`beanbag:${variant}`, () => beanbagShape(variant));
    }
    case "plant": {
      const tall = Boolean(item.tall);
      return paintedOfficeArt(`plant:${tall ? 1 : 0}`, () => plantShape(tall));
    }
    case "bookshelf": {
      const seed = item.seed ?? 0;
      return paintedOfficeArt(`bookshelf:${seed}`, () => bookshelfShape(seed));
    }
    case "printer":
      return paintedOfficeArt("printer", printerShape);
  }
}

const chairSeat = (): PaintedArt => paintedOfficeArt("chairSeat", chairSeatShape);
const chairBack = (side: "+x" | "-x" | "+y" | "-y"): PaintedArt =>
  paintedOfficeArt(`chairBack:${side}`, () => chairBackShape(side));
const doorArt = (open: boolean): PaintedArt =>
  paintedOfficeArt(`door:${open ? 1 : 0}`, () => doorShape(open));
const sparkleArt = (frame: number): PaintedArt =>
  paintedOverlay(`sparkle:${frame}`, () => sparkleShape(frame));

/** The pose someone settled at their place shows, and what they do at a desk. */
function settledPose(
  walker: Walker,
  input: SceneInput,
): { readonly pose: FigurePose; readonly activity: DeskActivity | null } {
  const placement = walker.placement;
  if (placement.kind !== "desk") return { pose: placement.pose, activity: null };
  // A Consultant turns round only once the asker has arrived, so the activity is worked out from who
  // stands at the desk now, not from the snapshot.
  const lookState = walker.leaving ? "idle" : (input.lookStates.get(walker.key) ?? "idle");
  const activity = deskActivity(lookState, input.walkers.visitorsOf(walker.key).length);
  return { pose: deskPoseOf(activity), activity };
}

/**
 * The office's sprites: the still floor and walls as one texture, the sky in the windows and the
 * sunlight on the floor, then desks, chairs, furniture and figures sorted by depth, the glows added
 * over them, and the overlays (signs, Zs, bubbles, tags, sparkles) over them all. Everything takes
 * the hour's tint but what gives off its own light (design decision 2): lit screens, the lamps'
 * bulbs, the sky, the exit sign, the coffee machine's LED, the "+N" tag and the overlays. Built again
 * whenever someone sets off or arrives; in between, `moveWalker` moves only the figures that walk.
 */
export class OfficeScene {
  /** Placed and scaled by the stage: one unit is one art pixel. */
  readonly world = new Container();
  /** The floor and walls, the sky in the windows over them, and the sunlight on the floor. */
  private readonly backdrop = new Container();
  private readonly items = new Container({ sortableChildren: true });
  /** Screens', lamps' and signs' glows, added to what is under them; hidden by day. */
  private readonly glows = new Container();
  private readonly overlays = new Container({ sortableChildren: true });
  /** Figures outside the room, clipped to the doorway, drawn over the open door. */
  private readonly doorway = new Container();
  private readonly doorwayMask = new Graphics();
  private floor: Sprite | null = null;
  private floorCanvas: HTMLCanvasElement | null = null;
  private floorWidth = -1;
  /** The floor and walls' grid, painted again with only the sky's indexes for each sky. */
  private floorGrid: PixelGrid | null = null;
  private readonly skyCanvases = new Map<Sky, HTMLCanvasElement>();
  private sky: Sprite | null = null;
  private sunCanvas: HTMLCanvasElement | null = null;
  private sun: Sprite | null = null;
  private readonly glowArts = new Map<GlowKind, PaintedArt>();
  /** The tint shown now, which the stage eases towards the hour's; null before the first drawing. */
  private tint: number | null = null;
  /** Every sprite that takes the hour's tint, the floor's included. */
  private tinted: Sprite[] = [];
  private door: Sprite | null = null;
  private doorOpen = false;
  private ringCanvas: HTMLCanvasElement | null = null;
  private ringSprite: Sprite | null = null;
  private ringKey: string | null = null;
  private animations: Animation[] = [];
  private readonly deskLooks = new Map<Desk, DeskLook>();
  /** Each figure on the floor by Role key, kept from one drawing to the next. */
  private readonly actors = new Map<string, Actor>();
  private input: SceneInput | null = null;
  /** Every figure that can be pressed, for hit-testing. */
  figures: readonly FigureHitBox[] = [];
  /** Every figure drawn, for the nameplates' anchors. */
  placed: readonly PlacedFigure[] = [];

  constructor(private readonly textures: StageTextures) {
    this.doorway.addChild(this.doorwayMask);
    this.doorway.mask = this.doorwayMask;
    this.doorway.zIndex = DOOR_DEPTH + 0.001;
    this.glows.blendMode = "add";
    this.world.addChild(this.backdrop, this.items, this.glows, this.overlays);
  }

  /** Draws the office afresh; the floor is painted again only when it grew. */
  build(input: SceneInput): void {
    this.input = input;
    this.tint ??= input.light.tint;
    this.tinted = [];
    this.paintFloor(input);
    // Everything is drawn afresh but the figures, which stay to be moved, and the doorway.
    const kept = new Set<Container>([
      this.doorway,
      this.doorwayMask,
      ...[...this.actors.values()].map((actor) => actor.sprite),
    ]);
    for (const child of this.items.removeChildren()) if (!kept.has(child)) child.destroy();
    for (const child of this.doorway.removeChildren()) if (!kept.has(child)) child.destroy();
    this.doorway.addChild(this.doorwayMask);
    for (const child of this.overlays.removeChildren()) child.destroy();
    for (const child of this.glows.removeChildren()) child.destroy();
    this.ringSprite = null;
    this.animations = [];
    const { geometry, walkers } = input;
    const at = (x: number, y: number, z = 0): FloorPoint => toArt(geometry, x, y, z);
    const add = (sprite: Sprite, depth: number): void => {
      sprite.zIndex = depth;
      this.items.addChild(sprite);
    };
    this.items.addChild(this.doorway);
    this.drawDoorway(geometry);
    this.doorOpen = walkers.doorOpen();
    this.door = this.shaded(
      artSprite(this.textures, doorArt(this.doorOpen), at(0, AISLE_ROW), null),
    );
    add(this.door, DOOR_DEPTH);
    this.addGlow("exitSign", at(0.05, AISLE_ROW + 0.5, 39));
    for (const desk of input.layout.desks) this.buildDesk(input, desk, add);
    for (const item of input.amenities.items) {
      const art = amenityArt(item);
      if (art)
        add(this.shaded(artSprite(this.textures, art, at(item.x, item.y), null)), item.depth);
      if (item.kind === "coffeeMachine") {
        const led = new Sprite(Texture.WHITE);
        led.setSize(1, 1);
        led.tint = ART_COLORS.machineLed;
        const point = at(item.x + 0.62, item.y + 0.5, 21);
        led.position.set(point.x, point.y);
        add(led, item.depth + 0.001);
        this.addGlow("led", at(item.x + 0.6, item.y + 0.5, 21));
      }
    }
    for (const seat of input.amenities.meetingSeats) {
      const depth = seat.depth ?? seat.x + seat.y;
      add(
        this.shaded(artSprite(this.textures, chairSeat(), at(seat.x, seat.y), null)),
        depth + 0.05,
      );
      if (seat.chairBack) {
        add(
          this.shaded(
            artSprite(this.textures, chairBack(seat.chairBack), at(seat.x, seat.y), null),
          ),
          depth + (seat.chairBack === "+y" ? 0.15 : 0.02),
        );
      }
    }
    const conversations = walkers.conversations();
    const placed: PlacedFigure[] = [];
    for (const walker of walkers.walkers()) {
      if (walker.hidden) continue;
      placed.push(this.buildFigure(input, walker, conversations.get(walker.key)));
    }
    this.placed = placed;
    this.figures = placed.filter((figure) => !figure.leaving && !figure.gone);
    const drawn = new Set(placed.map((figure) => figure.roleKey));
    for (const [roleKey, actor] of this.actors) {
      if (drawn.has(roleKey)) continue;
      actor.sprite.destroy();
      this.actors.delete(roleKey);
    }
    this.buildSparkles(input);
    this.placeRing();
    this.showLight(input.light);
  }

  /**
   * The hour's sky in the windows, the sunlight on the floor and how strongly things glow, without
   * drawing the office again; the tint is the stage's to ease (`setTint`).
   */
  showLight(light: Light): void {
    if (this.input) this.input = { ...this.input, light };
    if (this.sky) {
      const texture = this.textures.ofCanvas(this.skyCanvas(light.sky));
      if (this.sky.texture !== texture) this.sky.texture = texture;
    }
    if (this.sun) {
      this.sun.visible = light.sunPatch !== null;
      if (light.sunPatch) {
        this.sun.tint = light.sunPatch.color;
        this.sun.alpha = light.sunPatch.alpha;
      }
    }
    this.glows.alpha = light.glow;
    this.glows.visible = light.glow > 0;
  }

  /** The tint shown now; the stage eases it from one hour's to the next. Allocates nothing. */
  setTint(tint: number): void {
    this.tint = tint;
    for (const sprite of this.tinted) sprite.tint = tint;
  }

  /** The tint shown now, or null before the first drawing. */
  shownTint(): number | null {
    return this.tint;
  }

  /** One frame of the in-place animation; under the still office, called once with `motion` false. */
  animate(t: number, motion: boolean): void {
    for (const animation of this.animations) animation(t, motion);
  }

  /**
   * Moves a walking figure to where its walker is, in its walk cycle's frame; answers its place for
   * the nameplate, or null when it isn't drawn. Allocates nothing but a changed frame's texture.
   */
  moveWalker(walker: Walker): PlacedFigure | null {
    const input = this.input;
    const actor = this.actors.get(walker.key);
    if (!input || !actor?.place || !input.walkers.isOnTheMove(walker)) return null;
    const { sprite, place } = actor;
    const walk = input.walkers.poseOf(walker);
    if (walk.pose !== actor.pose || walk.frame !== actor.frame) {
      actor.pose = walk.pose;
      actor.frame = walk.frame;
      setArt(sprite, this.textures, paintedFigure(walker.key, actor.tone, walk.pose, walk.frame));
    }
    sprite.scale.x = walk.mirrored ? -1 : 1;
    const { origin } = input.geometry;
    const x = Math.round(origin.x + isoX(walker.x, walker.y));
    const y = Math.round(origin.y + isoY(walker.x, walker.y));
    sprite.position.set(x, y);
    const depth = input.walkers.depthOf(walker);
    sprite.zIndex = depth;
    place.feet.x = x;
    place.feet.y = y;
    place.depth = depth;
    place.seated = false;
    const outside = walker.x < INSIDE_FROM_X;
    if (outside !== place.outside) {
      place.outside = outside;
      (outside ? this.doorway : this.items).addChild(sprite);
    }
    if (this.ringSprite && this.ringKey === walker.key) {
      this.ringSprite.position.set(x, y);
      this.ringSprite.zIndex = depth - 0.001;
    }
    return place;
  }

  /** The door opens while someone walks through it. */
  setDoorOpen(open: boolean): void {
    if (!this.input || !this.door || open === this.doorOpen) return;
    this.doorOpen = open;
    showArt(this.door, this.textures, doorArt(open), toArt(this.input.geometry, 0, AISLE_ROW));
  }

  /** Rings a figure's feet (Show on the floor), or takes the ring away. */
  ring(roleKey: string | null): void {
    this.ringKey = roleKey;
    this.placeRing();
  }

  destroy(): void {
    this.world.destroy({ children: true });
    this.actors.clear();
    this.tinted = [];
    this.animations = [];
    this.input = null;
  }

  /** The floor and walls, the sky over them and the sunlight, painted again only when the floor grew. */
  private paintFloor(input: SceneInput): void {
    const { layout, geometry } = input;
    if (this.floor && this.floorWidth === layout.width) {
      this.shaded(this.floor);
      return;
    }
    const grid = new PixelGrid(geometry.width, geometry.height);
    const pen = isoPen(grid, geometry.origin.x, geometry.origin.y);
    paintFloorLayer(pen, layout);
    paintWalls(pen, layout);
    const canvas = paintGrid(grid, ART_PALETTE);
    const sunGrid = new PixelGrid(geometry.width, geometry.height);
    paintSunPatches(isoPen(sunGrid, geometry.origin.x, geometry.origin.y), layout);
    const sunCanvas = paintGrid(sunGrid, [null, 0xffffff]);
    for (const old of [this.floorCanvas, this.sunCanvas, ...this.skyCanvases.values()]) {
      if (old) this.textures.forget(old);
    }
    this.skyCanvases.clear();
    for (const child of this.backdrop.removeChildren()) child.destroy();
    this.floorGrid = grid;
    this.floorCanvas = canvas;
    this.sunCanvas = sunCanvas;
    this.floorWidth = layout.width;
    this.floor = this.shaded(new Sprite(this.textures.ofCanvas(canvas)));
    this.sky = new Sprite(this.textures.ofCanvas(this.skyCanvas(input.light.sky)));
    this.sun = new Sprite(this.textures.ofCanvas(sunCanvas));
    this.backdrop.addChild(this.floor, this.sky, this.sun);
  }

  /** The windows' glass (with night's stars) and the exit sign, in the sky's palette, the rest clear. */
  private skyCanvas(sky: Sky): HTMLCanvasElement {
    let canvas = this.skyCanvases.get(sky);
    if (!canvas) {
      const grid = this.floorGrid ?? new PixelGrid(1, 1);
      canvas = paintGrid(
        grid,
        artPalette(
          {
            ...SKY_PALETTES[sky],
            exitSign: ART_COLORS.exitSign,
            exitSignInk: ART_COLORS.exitSignInk,
          },
          true,
        ),
      );
      this.skyCanvases.set(sky, canvas);
    }
    return canvas;
  }

  /** Takes the hour's tint, now and as it eases. */
  private shaded<T extends Sprite>(sprite: T): T {
    sprite.tint = this.tint ?? 0xffffff;
    this.tinted.push(sprite);
    return sprite;
  }

  /** A glow at `at`, in the additive layer. */
  private addGlow(kind: GlowKind, at: FloorPoint): void {
    let art = this.glowArts.get(kind);
    if (!art) {
      art = paintGlow(kind);
      this.glowArts.set(kind, art);
    }
    const sprite = artSprite(this.textures, art, at, null);
    sprite.blendMode = "add";
    this.glows.addChild(sprite);
  }

  /** The doorway's opening in the left wall, which clips anyone outside the room. */
  private drawDoorway(geometry: OfficeGeometry): void {
    const corners = [
      toArt(geometry, 0, DOORWAY.from, 0),
      toArt(geometry, 0, DOORWAY.to, 0),
      toArt(geometry, 0, DOORWAY.to, DOORWAY.height),
      toArt(geometry, 0, DOORWAY.from, DOORWAY.height),
    ];
    this.doorwayMask
      .clear()
      .poly(corners.flatMap((corner) => [corner.x, corner.y]))
      .fill(0xffffff);
  }

  private buildDesk(
    input: SceneInput,
    desk: Desk,
    add: (sprite: Sprite, depth: number) => void,
  ): void {
    const { geometry, light, walkers } = input;
    const at = (x: number, y: number, z = 0): FloorPoint => toArt(geometry, x, y, z);
    const roleKey = desk.roleKey;
    const person = roleKey ? input.people.get(roleKey) : undefined;
    const lookState = roleKey ? input.lookStates.get(roleKey) : undefined;

    // The chair: out while someone sits there or the desk's owner is about today; pushed in, and the
    // monitors dark, once they were let go or went home, as soon as they are a step away.
    const sitterKey = roleKey ?? desk.formerKey;
    const walker = sitterKey ? walkers.get(sitterKey) : undefined;
    const atDesk = walker !== undefined && !walker.hidden && walker.placement.kind === "desk";
    const sitting = atDesk && !walkers.isOnTheMove(walker);
    const away =
      walker !== undefined &&
      (walker.hidden || (walker.target ?? walker.placement).kind === "gone");
    const kept = sitting || (person !== undefined && lookState !== "home" && !away);

    const monitors = person && lookState ? monitorsOf(person, lookState) : null;
    if (monitors) this.deskLooks.set(desk, { shown: monitors.shown, laptop: monitors.laptop });
    // An empty desk keeps the monitors of whoever sat there, dark.
    const { shown, laptop } = this.deskLooks.get(desk) ?? { shown: 2, laptop: false };
    const deskArt = paintedOfficeArt(`desk:${desk.group}:${shown}:${laptop ? 1 : 0}`, () =>
      deskShape(desk.group, shown, laptop),
    );
    const deskAt = at(desk.x, desk.y);
    add(this.shaded(artSprite(this.textures, deskArt, deskAt, null)), desk.depth);

    const slots = monitorSlots(shown);
    const lit = kept ? (monitors?.lit ?? 0) : 0;
    for (let i = 0; i < Math.min(lit, slots.length); i++) {
      const slot = slots[i] ?? 1;
      const screen = artSprite(this.textures, this.screenArt(slot, i * 2, laptop), deskAt, null);
      add(screen, desk.depth + 0.001 + i * 0.0001);
      this.addGlow("monitor", at(desk.x + 0.6, desk.y + slot, DESK_H + 6));
      const seed = seedOf(roleKey ?? "") % 6;
      let shownFrame = i * 2;
      this.animations.push((t, motion) => {
        const frame = motion ? (Math.floor(t * 1.5) + i * 2 + seed) % 6 : i * 2;
        if (frame === shownFrame) return;
        shownFrame = frame;
        showArt(screen, this.textures, this.screenArt(slot, frame, laptop), deskAt);
      });
    }
    if (monitors?.tag) {
      const last = slots[slots.length - 1] ?? 1;
      const { count } = monitors.tag;
      const tagLit = kept && monitors.tag.lit;
      const text = `+${count}`;
      const tag = artSprite(
        this.textures,
        paintedOverlay(`tag:${text}:${tagLit ? 1 : 0}`, () => tagShape(text, tagLit)),
        at(desk.x + 0.33, desk.y + last + 0.3, DESK_H + 15),
        null,
      );
      tag.zIndex = desk.depth;
      this.overlays.addChild(tag);
    }

    const turned = sitting && !walker.leaving && walkers.visitorsOf(walker.key).length > 0;
    const seat = this.shaded(artSprite(this.textures, chairSeat(), at(0, 0), null));
    const back = this.shaded(
      artSprite(this.textures, chairBack(turned ? "-x" : "+x"), at(0, 0), null),
    );
    const placeChair = (out: boolean): void => {
      const spot = out ? deskSpot(desk) : pushedInSpot(desk);
      const chairAt = at(spot.x, spot.y);
      seat.position.set(chairAt.x, chairAt.y);
      back.position.set(chairAt.x, chairAt.y);
    };
    add(seat, desk.depth + 0.05);
    add(back, desk.depth + (turned ? 0.07 : 0.15));
    placeChair(kept);
    if (!kept && atDesk && walkers.isOnTheMove(walker)) {
      const spot = deskSpot(desk);
      let out = true;
      placeChair(out);
      this.animations.push(() => {
        const near = Math.hypot(walker.x - spot.x, walker.y - spot.y) < 1;
        if (near === out) return;
        out = near;
        placeChair(out);
      });
    }

    // At dusk and night the lamp is on while someone sits at the desk; some who work late have a pizza.
    if (sitting && !walker.leaving && light.lampsOn) {
      const lamp = this.shaded(
        artSprite(
          this.textures,
          paintedOfficeArt("lamp", lampShape),
          at(desk.x + 0.55, desk.y + 0.25),
          null,
        ),
      );
      add(lamp, desk.depth + 0.002);
      const bulbAt = at(desk.x + 0.62, desk.y + 0.25, DESK_H + 7);
      const bulb = new Sprite(Texture.WHITE);
      bulb.setSize(BULB.width, BULB.height);
      bulb.tint = ART_COLORS.bulb;
      bulb.position.set(Math.round(bulbAt.x) - 1, Math.round(bulbAt.y));
      add(bulb, desk.depth + 0.0025);
      this.addGlow("lamp", at(desk.x + 0.6, desk.y + 0.5, DESK_H));
      const working = input.lookStates.get(walker.key) === "working";
      if (light.phase === "night" && working && seedOf(walker.key) % 2 === 0) {
        const pizza = artSprite(
          this.textures,
          paintedOfficeArt("pizza", pizzaShape),
          at(desk.x + 0.6, desk.y + 1.62),
          null,
        );
        add(this.shaded(pizza), desk.depth + 0.003);
      }
    }
  }

  private screenArt(slot: number, frame: number, laptop: boolean): PaintedArt {
    return paintedOfficeArt(`screen:${slot}:${frame}:${laptop ? 1 : 0}`, () =>
      screenShape(slot, frame, laptop),
    );
  }

  private actorOf(walker: Walker): Actor {
    let actor = this.actors.get(walker.key);
    if (!actor) {
      const sprite = new Sprite();
      sprite.cullable = true;
      actor = {
        sprite,
        tone: avatarTone(walker.person.name),
        place: null,
        pose: "stand-front",
        frame: -1,
      };
      this.actors.set(walker.key, actor);
    }
    actor.tone = avatarTone(walker.person.name);
    return actor;
  }

  private buildFigure(
    input: SceneInput,
    walker: Walker,
    talk: readonly string[] | undefined,
  ): PlacedFigure {
    const { geometry, walkers } = input;
    const actor = this.actorOf(walker);
    const figure = this.shaded(actor.sprite);
    const outside = walker.x < INSIDE_FROM_X;
    (outside ? this.doorway : this.items).addChild(figure);
    const feet = toArt(geometry, walker.x, walker.y);
    const place: PlacedFigure = {
      roleKey: walker.key,
      feet: { x: feet.x, y: feet.y },
      depth: walkers.depthOf(walker),
      seated: false,
      leaving: walker.leaving,
      gone: walker.hidden || (walker.target === null && walker.placement.kind === "gone"),
      outside,
    };
    actor.place = place;
    figure.zIndex = place.depth;
    if (walkers.isOnTheMove(walker)) {
      // Walking, or stopped mid-way for its turn at the door: `moveWalker` draws it in the walk
      // cycle; nothing shows over a figure on the move.
      actor.frame = -1;
      this.moveWalker(walker);
      return place;
    }

    const placement: Placement = walker.placement;
    const { pose, activity } = settledPose(walker, input);
    const { mirrored, z } = placement;
    place.seated = pose.startsWith("sit");
    const head = feet.y - ((place.seated ? 20 : 23) + z);
    const standAt = toArt(geometry, walker.x, walker.y, z);
    figure.position.set(standAt.x, standAt.y);
    figure.scale.x = mirrored ? -1 : 1;
    actor.pose = pose;
    actor.frame = 0;
    setArt(figure, this.textures, paintedFigure(walker.key, actor.tone, pose, 0));
    this.animations.push((t, motion) => {
      const frame = frameOf(
        pose,
        activity,
        walker.key,
        t,
        motion,
        isSpeaking(talk, walker.key, t, motion),
      );
      if (frame === actor.frame) return;
      actor.frame = frame;
      setArt(figure, this.textures, paintedFigure(walker.key, actor.tone, pose, frame));
    });
    // Someone let go, or waiting to set off elsewhere, shows nothing over them.
    if (walker.leaving || walker.target !== null) return place;

    const overlay = (art: PaintedArt, at: FloorPoint): Sprite => {
      const sprite = artSprite(this.textures, art, at, null);
      sprite.zIndex = place.depth;
      this.overlays.addChild(sprite);
      return sprite;
    };
    if (activity === "waiting") {
      const sign = overlay(paintedOverlay("sign", signShape), { x: feet.x + 5, y: head - 4 });
      this.animations.push((t, motion) => {
        const bob = motion ? Math.floor(t * 2) % 2 : 0;
        sign.y = head - 4 - bob;
      });
    }
    if (activity === "asleep") {
      const zz = paintedOverlay("zz", zShape, true);
      for (let i = 0; i < 2; i++) {
        const sprite = overlay(zz, feet);
        this.animations.push((t, motion) => {
          // Two Zs rising in turn; in the still office they stand still on the way up.
          const rise = motion ? (t * 0.45 + i * 0.5) % 1 : 0.3 + i * 0.45;
          sprite.visible = rise <= 0.9;
          sprite.position.set(Math.round(feet.x - 10 + rise * 4), Math.round(head + 2 - rise * 12));
        });
      }
    }
    if (talk) {
      const facesRight = pose.includes("front") !== mirrored;
      const bubbleAt = { x: feet.x + (facesRight ? 4 : -4), y: head - 2 };
      const bubbleArt = (dots: number): PaintedArt =>
        paintedOverlay(`bubble:${dots}:${facesRight ? 0 : 1}`, () =>
          bubbleShape(dots, !facesRight),
        );
      const bubble = overlay(bubbleArt(3), bubbleAt);
      let shownDots = 3;
      this.animations.push((t, motion) => {
        bubble.visible = isSpeaking(talk, walker.key, t, motion);
        const dots = motion ? (Math.floor(t * 3) % 3) + 1 : 3;
        if (dots === shownDots) return;
        shownDots = dots;
        showArt(bubble, this.textures, bubbleArt(dots), bubbleAt);
      });
    }
    return place;
  }

  /** A hire's new desk sparkles: four stars circling it, until the sparkle ends. */
  private buildSparkles(input: SceneInput): void {
    const { geometry, walkers, layout } = input;
    for (const sparkle of walkers.sparkles()) {
      const desk = deskOf(layout, sparkle.roleKey);
      if (!desk) continue;
      for (let i = 0; i < SPARKLES_PER_DESK; i++) {
        const sprite = artSprite(this.textures, sparkleArt(0), { x: 0, y: 0 }, null);
        sprite.zIndex = desk.depth + 1;
        this.overlays.addChild(sprite);
        let shownFrame = 0;
        this.animations.push((t) => {
          sprite.visible = walkers.time() < sparkle.until;
          if (!sprite.visible) return;
          const angle = t * 2 + (i * Math.PI) / 2;
          const frame = Math.floor(t * 6 + i) % 2;
          const point = toArt(
            geometry,
            desk.x + 0.5 + Math.cos(angle) * 0.7,
            desk.y + 1 + Math.sin(angle) * 0.9,
            22 + i * 3,
          );
          if (frame !== shownFrame) {
            shownFrame = frame;
            setArt(sprite, this.textures, sparkleArt(frame));
          }
          sprite.position.set(point.x, point.y);
        });
      }
    }
  }

  private placeRing(): void {
    const input = this.input;
    if (this.ringSprite) {
      this.ringSprite.destroy();
      this.ringSprite = null;
    }
    const place = this.ringKey ? this.actors.get(this.ringKey)?.place : undefined;
    if (!input || !place) return;
    if (!this.ringCanvas) {
      const { width, height, anchorX, anchorY } = RING_GRID;
      const grid = new PixelGrid(width, height);
      grid.ellipse(anchorX + 0.5, anchorY + 0.5, 12, 6, 1);
      grid.ellipse(anchorX + 0.5, anchorY + 0.5, 11, 5, 0);
      this.ringCanvas = paintGrid(grid, [null, ART_COLORS.nextDesk]);
    }
    const ringArt: PaintedArt = {
      canvas: this.ringCanvas,
      anchorX: RING_GRID.anchorX,
      anchorY: RING_GRID.anchorY,
    };
    this.ringSprite = artSprite(this.textures, ringArt, place.feet, null);
    this.ringSprite.zIndex = place.depth - 0.001;
    this.items.addChild(this.ringSprite);
  }
}
