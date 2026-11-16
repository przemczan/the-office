import { Application, Culler, UPDATE_PRIORITY } from "pixi.js";
import { forgetPaintedArt } from "./art/pixel-grid.ts";
import { NAMEPLATE_BELOW_FEET, figureAnchor } from "./figure-hit.ts";
import { addHire, amenitiesOf, layoutOffice, letGo } from "./floor-plan.ts";
import type {
  Amenities,
  CreateOfficeStage,
  Layout,
  Light,
  OfficePerson,
  OfficeStage,
} from "./live-view-types.ts";
import { type SeenLight, lookStatesOf, placementsOf, walksAtLightChange } from "./live-states.ts";
import {
  type ArtRect,
  type OfficeGeometry,
  officeBounds,
  officeGeometryOf,
} from "./office-geometry.ts";
import { routeFloorOf } from "./routes.ts";
import { OfficeScene, type SceneInput } from "./stage-scene.ts";
import { attachStageInput } from "./stage-input.ts";
import { StageTextures } from "./stage-textures.ts";
import {
  type Point,
  type View,
  artOrigin,
  canZoomIn,
  canZoomOut,
  clampView,
  createView,
  figureFrame,
  fitView,
  frameFigure,
  resizeView,
  scaleOf,
  zoomPercent,
  zoomStep,
} from "./view.ts";
import { type Walkers, createWalkers } from "./walkers.ts";

/** How long Show on the floor rings a figure. */
const RING_MS = 3000;
/** The longest step the animation clock takes in one frame, so a stalled frame doesn't jump. */
const MAX_FRAME_SECONDS = 0.25;
/** How long the tint takes to ease from one hour's light to the next. */
const TINT_FADE_SECONDS = 2;

interface Floor {
  readonly layout: Layout;
  amenities: Amenities;
  geometry: OfficeGeometry;
  bounds: ArtRect;
  /** The people the floor was last drawn for, by Role key. */
  people: ReadonlySet<string>;
  readonly walkers: Walkers;
  /** What the scene was last built from, to build it again when someone sets off or arrives. */
  scene: SceneInput | null;
}

/**
 * The PixiJS floor (design decisions 2, 8, 10, 12, 13, 15 and 16): the office laid out once per page
 * open, hires and those let go changing only their own desk, people walking where the snapshot
 * sends them, pan and zoom by whole device pixels, one ticker for the walks and the in-place
 * animation while the page is visible and never under the still office, where every move is a jump.
 */
export const createOfficeStage: CreateOfficeStage = async (canvas, options) => {
  const app = new Application();
  const { width, height } = boxOf(canvas);
  await app.init({
    canvas,
    width: Math.max(1, width),
    height: Math.max(1, height),
    antialias: false,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
    backgroundAlpha: 0,
    autoStart: false,
    sharedTicker: false,
    // Without WebGL (or WebGPU) init rejects, and the page says the floor can't be drawn.
    preference: ["webgl", "webgpu"],
  });
  const textures = new StageTextures();
  const scene = new OfficeScene(textures);
  app.stage.addChild(scene.world);

  let view: View = createView(width, height, window.devicePixelRatio || 1);
  let floor: Floor | null = null;
  let clock = 0;
  let lastTick = 0;
  let ringTimer: ReturnType<typeof setTimeout> | undefined;
  let destroyed = false;
  /** Someone set off, arrived or left: the scene is built again on the next frame. */
  let walkersChanged = false;
  const markWalkersChanged = (): void => {
    walkersChanged = true;
  };
  /** The hour's light, set by the page before the first `apply`; nothing is drawn without it. */
  let shownLight: Light | null = null;
  let seen: SeenLight | null = null;
  /** The people last applied, drawn again when the light changes. */
  let applied: readonly OfficePerson[] | null = null;
  /** The tint easing from `from` to `to`, from the animation clock's `start`; null when still. */
  let fade: { from: number; to: number; start: number } | null = null;

  /* ---------- Drawing ---------- */

  const ticking = (): boolean => app.ticker.started;
  const cull = (): void => Culler.shared.cull(app.stage, app.screen);
  const onTick = (): void => {
    const now = performance.now();
    const seconds = Math.min(MAX_FRAME_SECONDS, Math.max(0, (now - lastTick) / 1000));
    clock += seconds;
    lastTick = now;
    if (floor) walk(floor, seconds);
    if (fade) easeTint(fade);
    scene.animate(clock, true);
    cull();
  };
  /** Moves every walk on, the figures and their nameplates with it, and opens the door for them. */
  const walk = (on: Floor, seconds: number): void => {
    const moved = on.walkers.step(seconds);
    if (moved.length > 0) {
      const origin = artOrigin(view);
      const scale = scaleOf(view);
      for (const walker of moved) {
        const place = scene.moveWalker(walker);
        if (!place) continue;
        options.onFigureMove(
          walker.key,
          origin.x + place.feet.x * scale,
          origin.y + (place.feet.y + NAMEPLATE_BELOW_FEET) * scale,
          place.outside,
        );
      }
    }
    scene.setDoorOpen(on.walkers.doorOpen());
    if (walkersChanged && on.scene) {
      walkersChanged = false;
      scene.build(on.scene);
      reportView();
    }
  };
  /** One step of the tint's fade, channel by channel; allocates nothing. */
  const easeTint = (on: { from: number; to: number; start: number }): void => {
    const progress = Math.min(1, (clock - on.start) / TINT_FADE_SECONDS);
    if (progress >= 1) {
      scene.setTint(on.to);
      fade = null;
      return;
    }
    const channel = (shift: number): number => {
      const from = (on.from >> shift) & 0xff;
      const to = (on.to >> shift) & 0xff;
      return Math.round(from + (to - from) * progress) << shift;
    };
    scene.setTint(channel(16) | channel(8) | channel(0));
  };
  // Before the app's own render, which the ticker runs at a lower priority.
  app.ticker.add(onTick, undefined, UPDATE_PRIORITY.NORMAL);

  const startTicker = (): void => {
    if (destroyed || options.reducedMotion || document.hidden || ticking()) return;
    lastTick = performance.now();
    app.ticker.start();
  };
  const stopTicker = (): void => {
    if (ticking()) app.ticker.stop();
  };
  /** Draws once when nothing ticks: the still office, a hidden page, or before the ticker's next frame. */
  const render = (): void => {
    if (destroyed || ticking()) return;
    scene.animate(options.reducedMotion ? 0 : clock, !options.reducedMotion);
    cull();
    app.render();
  };

  /* ---------- The view ---------- */

  const placeWorld = (): void => {
    const origin = artOrigin(view);
    const scale = scaleOf(view);
    scene.world.position.set(origin.x, origin.y);
    scene.world.scale.set(scale);
  };
  const feetOf = (roleKey: string): Point | null => {
    const place = scene.figures.find((figure) => figure.roleKey === roleKey);
    return place ? { x: place.feet.x, y: place.feet.y } : null;
  };
  const reportView = (): void => {
    options.onView({
      scale: scaleOf(view),
      zoomPercent: zoomPercent(view),
      canZoomIn: canZoomIn(view),
      canZoomOut: canZoomOut(view),
      // Someone gone home is not drawn, so has no nameplate.
      anchors: scene.placed
        .filter((figure) => !figure.gone)
        .map((figure) => ({
          roleKey: figure.roleKey,
          ...figureAnchor(view, figure.feet),
          outside: figure.outside,
          leaving: figure.leaving,
        })),
    });
  };
  /** Every change of view: clamped, the world placed again, drawn when still, and told to the page. */
  const setView = (next: View): void => {
    view = floor ? clampView(next, floor.bounds) : next;
    placeWorld();
    render();
    reportView();
  };

  const resize = (): void => {
    if (destroyed) return;
    const box = boxOf(canvas);
    const ratio = window.devicePixelRatio || 1;
    if (box.width <= 0 || box.height <= 0) return;
    if (box.width === view.width && box.height === view.height && ratio === view.devicePixelRatio)
      return;
    app.renderer.resize(box.width, box.height, ratio);
    if (!floor) {
      view = { ...view, width: box.width, height: box.height, devicePixelRatio: ratio };
      return;
    }
    const framed = view.framing.kind === "figure" ? feetOf(view.framing.roleKey) : null;
    setView(
      resizeView(
        view,
        box.width,
        box.height,
        ratio,
        floor.bounds,
        framed ? figureFrame(framed) : undefined,
      ),
    );
  };

  /* ---------- The snapshot ---------- */

  const apply = (next: readonly OfficePerson[], now: Date): void => {
    if (destroyed) return;
    applied = next;
    if (shownLight) applyAt(next, shownLight, now);
  };

  const applyAt = (people: readonly OfficePerson[], light: Light, now: Date): void => {
    const keys = new Set(people.map((person) => person.roleKey));
    const first = floor === null;
    if (!floor) floor = layOut(people);
    else {
      // A hire takes a desk and someone let go leaves theirs empty; nobody else moves.
      const widthBefore = floor.layout.width;
      let hired = false;
      for (const person of people) {
        if (floor.people.has(person.roleKey)) continue;
        addHire(floor.layout, person);
        hired = true;
      }
      for (const roleKey of floor.people) if (!keys.has(roleKey)) letGo(floor.layout, roleKey);
      floor.people = keys;
      if (floor.layout.width !== widthBefore) {
        floor.geometry = officeGeometryOf(floor.layout);
        floor.bounds = officeBounds(floor.layout, floor.geometry);
        floor.amenities = amenitiesOf(floor.layout);
      }
      // The hire's desk blocks its tiles: walks in flight go round it.
      if (hired) floor.walkers.setFloor(routeFloorOf(floor.layout, floor.amenities));
    }
    place(floor, people, light, now, !options.reducedMotion && !first);
    if (first || view.framing.kind === "office") setView(fitView(view, floor.bounds));
    else setView(view);
  };

  /** Sends everyone where the snapshot and the light put them, and draws the office again. */
  const place = (
    on: Floor,
    people: readonly OfficePerson[],
    light: Light,
    now: Date,
    animate: boolean,
  ): void => {
    const placements = placementsOf(people, on.layout, on.amenities, light, now);
    on.walkers.direct(people, placements, { animate });
    on.scene = {
      layout: on.layout,
      amenities: on.amenities,
      geometry: on.geometry,
      people: new Map(people.map((person) => [person.roleKey, person])),
      lookStates: lookStatesOf(people, now, light),
      walkers: on.walkers,
      light,
    };
    walkersChanged = false;
    scene.build(on.scene);
  };

  /* ---------- The hour's light ---------- */

  const setLight = (next: Light, now: Date): void => {
    if (destroyed) return;
    const previous = shownLight;
    shownLight = next;
    // Nightfall and dawn walk people out and in only when seen live (a hidden tab's clock still
    // ticks, but nothing walks there); any other change of light walks what the minute changed (who
    // fell asleep), as `apply` does.
    const crossesNight =
      previous !== null && (previous.phase === "night") !== (next.phase === "night");
    const walks =
      !options.reducedMotion &&
      (!crossesNight || (!document.hidden && walksAtLightChange(seen, next, now)));
    seen = { light: next, at: now };
    if (!floor) {
      // `apply` came first and waited for the light.
      if (applied) applyAt(applied, next, now);
      return;
    }
    if (previous && !lightChanged(previous, next)) return;
    const from = scene.shownTint();
    if (from !== null && from !== next.tint && !options.reducedMotion && ticking()) {
      fade = { from, to: next.tint, start: clock };
    } else {
      fade = null;
      scene.setTint(next.tint);
    }
    // Night begins or ends, or the lamps come on: people go home or come back, desks change.
    if (!previous || previous.phase !== next.phase || previous.lampsOn !== next.lampsOn) {
      if (applied) place(floor, applied, next, now, walks);
      reportView();
    } else {
      if (floor.scene) floor.scene = { ...floor.scene, light: next };
      scene.showLight(next);
    }
    render();
  };

  const layOut = (people: readonly OfficePerson[]): Floor => {
    const layout = layoutOffice(people);
    const geometry = officeGeometryOf(layout);
    const amenities = amenitiesOf(layout);
    const walkers = createWalkers(routeFloorOf(layout, amenities), {
      onArrive: markWalkersChanged,
      onDepart: markWalkersChanged,
      onGone: markWalkersChanged,
    });
    return {
      layout,
      amenities,
      geometry,
      bounds: officeBounds(layout, geometry),
      people: new Set(people.map((person) => person.roleKey)),
      walkers,
      scene: null,
    };
  };

  /* ---------- Show on the floor, zoom and fit ---------- */

  const frame = (roleKey: string): void => {
    const feet = feetOf(roleKey);
    if (!floor || !feet) return;
    clearTimeout(ringTimer);
    scene.ring(roleKey);
    setView(frameFigure(view, roleKey, feet, floor.bounds));
    ringTimer = setTimeout(() => {
      scene.ring(null);
      render();
    }, RING_MS);
  };
  const zoomBy = (direction: 1 | -1, anchor?: Point): void => {
    if (!floor) return;
    const anchorAt = anchor ?? { x: view.width / 2, y: view.height / 2 };
    setView(zoomStep(view, direction, floor.bounds, anchorAt.x, anchorAt.y));
  };
  const fit = (): void => {
    if (floor) setView(fitView(view, floor.bounds));
  };

  /* ---------- Input, size and visibility ---------- */

  const detachInput = attachStageInput(canvas, {
    current: () => (floor ? { view, bounds: floor.bounds } : null),
    setView,
    zoomStep: zoomBy,
    fit,
    figures: () => scene.figures,
    onHover: options.onHover,
    onPress: options.onPress,
  });
  const observer = new ResizeObserver(() => resize());
  observer.observe(canvas.parentElement ?? canvas);
  const onVisibility = (): void => {
    if (document.hidden) stopTicker();
    else {
      startTicker();
      render();
    }
  };
  document.addEventListener("visibilitychange", onVisibility);
  startTicker();

  const stage: OfficeStage = {
    apply,
    setLight,
    frame,
    zoomStep: (direction) => zoomBy(direction),
    fit,
    resize,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      clearTimeout(ringTimer);
      detachInput();
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      stopTicker();
      app.ticker.remove(onTick);
      scene.destroy();
      textures.destroy();
      forgetPaintedArt();
      // React owns the canvas: the renderer goes, the canvas stays.
      app.destroy({ removeView: false }, { children: true });
    },
  };
  return stage;
};

/** Whether the floor looks different in `next`; the minutes alone change nothing drawn. */
function lightChanged(previous: Light, next: Light): boolean {
  return (
    previous.phase !== next.phase ||
    previous.tint !== next.tint ||
    previous.sky !== next.sky ||
    previous.lampsOn !== next.lampsOn ||
    previous.glow !== next.glow ||
    previous.sunPatch?.color !== next.sunPatch?.color ||
    previous.sunPatch?.alpha !== next.sunPatch?.alpha
  );
}

/** The canvas's CSS box: its parent's, which the canvas fills, so autoDensity's inline size doesn't feed back. */
function boxOf(canvas: HTMLCanvasElement): { width: number; height: number } {
  const box = canvas.parentElement ?? canvas;
  return { width: Math.round(box.clientWidth), height: Math.round(box.clientHeight) };
}
