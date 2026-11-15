import { Container, Sprite, Texture } from "pixi.js";
import { paintedFigure, seedOf } from "./art/figures.ts";
import { paintFloorLayer, paintWalls } from "./art/floor-art.ts";
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
  plantShape,
  printerShape,
  screenShape,
  sofaShape,
  waterCoolerShape,
} from "./art/furniture.ts";
import { DESK_H } from "./art/iso.ts";
import { bubbleShape, paintedOverlay, signShape, tagShape, zShape } from "./art/overlays.ts";
import { ART_COLORS, ART_PALETTE, avatarTone, paintedOfficeArt } from "./art/palettes.ts";
import { type PaintedArt, PixelGrid, isoPen, paintGrid } from "./art/pixel-grid.ts";
import type { FigureHitBox } from "./figure-hit.ts";
import { AISLE_ROW, deskSpot, pushedInSpot } from "./floor-plan.ts";
import type {
  Amenities,
  Amenity,
  Desk,
  FloorPoint,
  Layout,
  Light,
  LookState,
  OfficePerson,
  Placement,
} from "./live-view-types.ts";
import { monitorsOf } from "./live-states.ts";
import { type OfficeGeometry, toArt } from "./office-geometry.ts";
import { type StageTextures, artSprite, setArt, showArt } from "./stage-textures.ts";

/** What one drawing of the office is made of: the floor plan and everyone's placement at the hour's light. */
export interface SceneInput {
  readonly layout: Layout;
  readonly amenities: Amenities;
  readonly geometry: OfficeGeometry;
  readonly people: ReadonlyMap<string, OfficePerson>;
  readonly lookStates: ReadonlyMap<string, LookState>;
  readonly placements: ReadonlyMap<string, Placement>;
  readonly light: Light;
}

/** Moves a sprite's look on with the animation clock `t` (seconds); `motion` false draws the still office. */
type Animation = (t: number, motion: boolean) => void;

interface DeskLook {
  readonly shown: number;
  readonly laptop: boolean;
}

const SPEAKING_TURN_SECONDS = 1.8;
const RING_GRID = { width: 27, height: 15, anchorX: 13, anchorY: 7 } as const;

/** Whose turn it is to speak in a conversation; in the still office everyone in it shows a bubble. */
function isSpeaking(placement: Placement, roleKey: string, t: number, motion: boolean): boolean {
  const talk = placement.conversation;
  if (!talk || talk.length === 0) return false;
  if (!motion) return true;
  return talk[Math.floor(t / SPEAKING_TURN_SECONDS) % talk.length] === roleKey;
}

/** The pose's frame at `t`: typing, the raised hand, sleep's breathing and talking, each at its own rate. */
function frameOf(
  placement: Placement,
  roleKey: string,
  t: number,
  motion: boolean,
  speaking: boolean,
): number {
  const tick = (rate: number, offset = 0): number => (motion ? Math.floor(t * rate + offset) : 0);
  const offset = (seedOf(roleKey) % 10) / 10;
  switch (placement.pose) {
    case "sit-back-raise":
      return tick(1.6) % 2;
    case "sit-back-sleep":
      return tick(0.7, offset) % 2;
    case "sit-back":
      return placement.activity === "working" ? tick(5, offset * 3) % 2 : 0;
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

/**
 * Puts a figure where its placement says, at once: its feet on the spot, lifted by the seat, turned
 * as the placement faces. This is the seam the movement Task replaces with walking there round the
 * furniture; nothing else in the stage moves a figure.
 */
function moveFigure(actor: Sprite, placement: Placement, standAt: FloorPoint): void {
  actor.position.set(standAt.x, standAt.y);
  actor.scale.x = placement.mirrored ? -1 : 1;
}

const chairSeat = (): PaintedArt => paintedOfficeArt("chairSeat", chairSeatShape);
const chairBack = (side: "+x" | "-x" | "+y" | "-y"): PaintedArt =>
  paintedOfficeArt(`chairBack:${side}`, () => chairBackShape(side));

/**
 * The office's sprites: the still floor and walls as one texture, then desks, chairs, furniture and
 * figures sorted by depth, and the overlays (signs, Zs, bubbles, tags) over them all, untinted.
 */
export class OfficeScene {
  /** Placed and scaled by the stage: one unit is one art pixel. */
  readonly world = new Container();
  private readonly items = new Container({ sortableChildren: true });
  private readonly overlays = new Container({ sortableChildren: true });
  private floor: Sprite | null = null;
  private floorCanvas: HTMLCanvasElement | null = null;
  private floorWidth = -1;
  private ringCanvas: HTMLCanvasElement | null = null;
  private ringSprite: Sprite | null = null;
  private ringKey: string | null = null;
  private animations: Animation[] = [];
  private readonly deskLooks = new Map<Desk, DeskLook>();
  /** Each figure on the floor by Role key, kept from one drawing to the next. */
  private readonly actors = new Map<string, Sprite>();
  private input: SceneInput | null = null;
  /** Every figure on the floor, for hit-testing and the nameplates' anchors. */
  figures: readonly FigureHitBox[] = [];

  constructor(private readonly textures: StageTextures) {
    this.world.addChild(this.items, this.overlays);
  }

  /** Draws the office afresh from a snapshot's placements; the floor is painted again only when it grew. */
  build(input: SceneInput): void {
    this.input = input;
    this.paintFloor(input);
    // Everything is drawn afresh but the figures, which stay to be moved.
    const actors = new Set<Container>(this.actors.values());
    for (const child of this.items.removeChildren()) if (!actors.has(child)) child.destroy();
    for (const child of this.overlays.removeChildren()) child.destroy();
    this.ringSprite = null;
    this.animations = [];
    const { geometry, light } = input;
    const at = (x: number, y: number, z = 0): FloorPoint => toArt(geometry, x, y, z);
    const add = (sprite: Sprite, depth: number): void => {
      sprite.zIndex = depth;
      this.items.addChild(sprite);
    };
    add(
      artSprite(
        this.textures,
        paintedOfficeArt("door:0", () => doorShape(false)),
        at(0, AISLE_ROW),
        light.tint,
      ),
      AISLE_ROW + 0.3,
    );
    for (const desk of input.layout.desks) this.buildDesk(input, desk, add);
    for (const item of input.amenities.items) {
      const art = amenityArt(item);
      if (art) add(artSprite(this.textures, art, at(item.x, item.y), light.tint), item.depth);
      if (item.kind === "coffeeMachine") {
        const led = new Sprite(Texture.WHITE);
        led.setSize(1, 1);
        led.tint = ART_COLORS.machineLed;
        const point = at(item.x + 0.62, item.y + 0.5, 21);
        led.position.set(point.x, point.y);
        add(led, item.depth + 0.001);
      }
    }
    for (const seat of input.amenities.meetingSeats) {
      const depth = seat.depth ?? seat.x + seat.y;
      add(artSprite(this.textures, chairSeat(), at(seat.x, seat.y), light.tint), depth + 0.05);
      if (seat.chairBack) {
        add(
          artSprite(this.textures, chairBack(seat.chairBack), at(seat.x, seat.y), light.tint),
          depth + (seat.chairBack === "+y" ? 0.15 : 0.02),
        );
      }
    }
    const figures: FigureHitBox[] = [];
    for (const [roleKey, placement] of input.placements) {
      const person = input.people.get(roleKey);
      if (!person || placement.kind === "gone") continue;
      this.buildFigure(input, roleKey, person, placement, add);
      figures.push({
        roleKey,
        feet: at(placement.spot.x, placement.spot.y),
        depth: placement.depth,
        seated: placement.pose.startsWith("sit"),
      });
    }
    this.figures = figures;
    const onFloor = new Set(figures.map((figure) => figure.roleKey));
    for (const [roleKey, actor] of this.actors) {
      if (onFloor.has(roleKey)) continue;
      actor.destroy();
      this.actors.delete(roleKey);
    }
    this.placeRing();
  }

  /** One frame of the in-place animation; under the still office, called once with `motion` false. */
  animate(t: number, motion: boolean): void {
    for (const animation of this.animations) animation(t, motion);
  }

  /** Rings a figure's feet (Show on the floor), or takes the ring away. */
  ring(roleKey: string | null): void {
    this.ringKey = roleKey;
    this.placeRing();
  }

  destroy(): void {
    this.world.destroy({ children: true });
    this.actors.clear();
    this.animations = [];
    this.input = null;
  }

  private paintFloor(input: SceneInput): void {
    const { layout, geometry } = input;
    if (this.floor && this.floorWidth === layout.width) {
      this.floor.tint = input.light.tint;
      return;
    }
    const grid = new PixelGrid(geometry.width, geometry.height);
    const pen = isoPen(grid, geometry.origin.x, geometry.origin.y);
    paintFloorLayer(pen, layout);
    paintWalls(pen, layout);
    const canvas = paintGrid(grid, ART_PALETTE);
    if (this.floorCanvas) this.textures.forget(this.floorCanvas);
    this.floor?.destroy();
    this.floorCanvas = canvas;
    this.floorWidth = layout.width;
    this.floor = new Sprite(this.textures.ofCanvas(canvas));
    this.floor.tint = input.light.tint;
    this.world.addChildAt(this.floor, 0);
  }

  private buildDesk(
    input: SceneInput,
    desk: Desk,
    add: (sprite: Sprite, depth: number) => void,
  ): void {
    const { geometry, light } = input;
    const at = (x: number, y: number, z = 0): FloorPoint => toArt(geometry, x, y, z);
    const roleKey = desk.roleKey;
    const person = roleKey ? input.people.get(roleKey) : undefined;
    const lookState = roleKey ? input.lookStates.get(roleKey) : undefined;
    const monitors = person && lookState ? monitorsOf(person, lookState) : null;
    if (monitors) this.deskLooks.set(desk, { shown: monitors.shown, laptop: monitors.laptop });
    // An empty desk keeps the monitors of whoever sat there, dark.
    const { shown, laptop } = this.deskLooks.get(desk) ?? { shown: 2, laptop: false };
    const deskArt = paintedOfficeArt(`desk:${desk.group}:${shown}:${laptop ? 1 : 0}`, () =>
      deskShape(desk.group, shown, laptop),
    );
    const deskAt = at(desk.x, desk.y);
    add(artSprite(this.textures, deskArt, deskAt, light.tint), desk.depth);

    const slots = monitorSlots(shown);
    const lit = monitors?.lit ?? 0;
    for (let i = 0; i < Math.min(lit, slots.length); i++) {
      const slot = slots[i] ?? 1;
      const screen = artSprite(this.textures, this.screenArt(slot, i * 2, laptop), deskAt, null);
      add(screen, desk.depth + 0.001 + i * 0.0001);
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
      const { count, lit: tagLit } = monitors.tag;
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

    // The chair: pulled out while its person is in today, pushed in once they left or went home.
    const placement = roleKey ? input.placements.get(roleKey) : undefined;
    const sitting = placement?.kind === "desk";
    const out = sitting || (person !== undefined && lookState !== "home");
    const turned = sitting && placement.activity === "talking";
    const spot = out ? deskSpot(desk) : pushedInSpot(desk);
    const chairAt = at(spot.x, spot.y);
    add(artSprite(this.textures, chairSeat(), chairAt, light.tint), desk.depth + 0.05);
    add(
      artSprite(this.textures, chairBack(turned ? "-x" : "+x"), chairAt, light.tint),
      desk.depth + (turned ? 0.07 : 0.15),
    );
    if (sitting && light.lampsOn) {
      add(
        artSprite(
          this.textures,
          paintedOfficeArt("lamp", lampShape),
          at(desk.x + 0.55, desk.y + 0.25),
          null,
        ),
        desk.depth + 0.002,
      );
    }
  }

  private screenArt(slot: number, frame: number, laptop: boolean): PaintedArt {
    return paintedOfficeArt(`screen:${slot}:${frame}:${laptop ? 1 : 0}`, () =>
      screenShape(slot, frame, laptop),
    );
  }

  private buildFigure(
    input: SceneInput,
    roleKey: string,
    person: OfficePerson,
    placement: Placement,
    add: (sprite: Sprite, depth: number) => void,
  ): void {
    const { geometry, light } = input;
    const tone = avatarTone(person.name);
    const { spot, pose, mirrored, z } = placement;
    const feet = toArt(geometry, spot.x, spot.y);
    const head = feet.y - ((pose.startsWith("sit") ? 20 : 23) + z);

    let actor = this.actors.get(roleKey);
    if (!actor) {
      actor = new Sprite();
      actor.cullable = true;
      this.actors.set(roleKey, actor);
    }
    const figure = actor;
    figure.tint = light.tint;
    setArt(figure, this.textures, paintedFigure(roleKey, tone, pose, 0));
    moveFigure(figure, placement, toArt(geometry, spot.x, spot.y, z));
    add(figure, placement.depth);
    let shownFrame = 0;
    this.animations.push((t, motion) => {
      const frame = frameOf(
        placement,
        roleKey,
        t,
        motion,
        isSpeaking(placement, roleKey, t, motion),
      );
      if (frame === shownFrame) return;
      shownFrame = frame;
      setArt(figure, this.textures, paintedFigure(roleKey, tone, pose, frame));
    });

    const overlay = (art: PaintedArt, at: FloorPoint): Sprite => {
      const sprite = artSprite(this.textures, art, at, null);
      sprite.zIndex = placement.depth;
      this.overlays.addChild(sprite);
      return sprite;
    };
    if (placement.activity === "waiting") {
      const sign = overlay(paintedOverlay("sign", signShape), { x: feet.x + 5, y: head - 4 });
      this.animations.push((t, motion) => {
        const bob = motion ? Math.floor(t * 2) % 2 : 0;
        sign.y = head - 4 - bob;
      });
    }
    if (placement.activity === "asleep") {
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
    if (placement.conversation) {
      const facesRight = pose.includes("front") !== mirrored;
      const bubbleAt = { x: feet.x + (facesRight ? 4 : -4), y: head - 2 };
      const bubbleArt = (dots: number): PaintedArt =>
        paintedOverlay(`bubble:${dots}:${facesRight ? 0 : 1}`, () =>
          bubbleShape(dots, !facesRight),
        );
      const bubble = overlay(bubbleArt(3), bubbleAt);
      let shownDots = 3;
      this.animations.push((t, motion) => {
        bubble.visible = isSpeaking(placement, roleKey, t, motion);
        const dots = motion ? (Math.floor(t * 3) % 3) + 1 : 3;
        if (dots === shownDots) return;
        shownDots = dots;
        showArt(bubble, this.textures, bubbleArt(dots), bubbleAt);
      });
    }
  }

  private placeRing(): void {
    const input = this.input;
    if (this.ringSprite) {
      this.ringSprite.destroy();
      this.ringSprite = null;
    }
    const placement = this.ringKey ? input?.placements.get(this.ringKey) : undefined;
    if (!input || !placement || placement.kind === "gone") return;
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
    const feet = toArt(input.geometry, placement.spot.x, placement.spot.y);
    this.ringSprite = artSprite(this.textures, ringArt, feet, null);
    this.ringSprite.zIndex = placement.depth - 0.001;
    this.items.addChild(this.ringSprite);
  }
}
