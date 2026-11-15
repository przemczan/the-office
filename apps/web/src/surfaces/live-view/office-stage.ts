import { Application, Culler, UPDATE_PRIORITY } from "pixi.js";
import { forgetPaintedArt } from "./art/pixel-grid.ts";
import { figureAnchor } from "./figure-hit.ts";
import { addHire, amenitiesOf, layoutOffice, letGo } from "./floor-plan.ts";
import { lightAt } from "./light.ts";
import type {
  Amenities,
  CreateOfficeStage,
  Layout,
  OfficePerson,
  OfficeStage,
  Placement,
} from "./live-view-types.ts";
import { lookStatesOf, placementsOf } from "./live-states.ts";
import {
  type ArtRect,
  type OfficeGeometry,
  officeBounds,
  officeGeometryOf,
  toArt,
} from "./office-geometry.ts";
import { OfficeScene } from "./stage-scene.ts";
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

/** How long Show on the floor rings a figure. */
const RING_MS = 3000;
/** The longest step the animation clock takes in one frame, so a stalled frame doesn't jump. */
const MAX_FRAME_SECONDS = 0.25;

interface Floor {
  readonly layout: Layout;
  amenities: Amenities;
  geometry: OfficeGeometry;
  bounds: ArtRect;
  /** The people the floor was last drawn for, by Role key. */
  people: ReadonlySet<string>;
  placements: ReadonlyMap<string, Placement>;
}

/**
 * The PixiJS floor (design decisions 2, 10, 13, 15 and 16): the office laid out once per page open,
 * hires and those let go changing only their own desk, pan and zoom by whole device pixels, one
 * ticker for the in-place animation while the page is visible and never under the still office.
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

  /* ---------- Drawing ---------- */

  const ticking = (): boolean => app.ticker.started;
  const cull = (): void => Culler.shared.cull(app.stage, app.screen);
  const onTick = (): void => {
    const now = performance.now();
    clock += Math.min(MAX_FRAME_SECONDS, Math.max(0, (now - lastTick) / 1000));
    lastTick = now;
    scene.animate(clock, true);
    cull();
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
    if (!floor) return null;
    const placement = floor.placements.get(roleKey);
    if (!placement || placement.kind === "gone") return null;
    return toArt(floor.geometry, placement.spot.x, placement.spot.y);
  };
  const reportView = (): void => {
    options.onView({
      scale: scaleOf(view),
      zoomPercent: zoomPercent(view),
      canZoomIn: canZoomIn(view),
      canZoomOut: canZoomOut(view),
      anchors: scene.figures.map((figure) => ({
        roleKey: figure.roleKey,
        ...figureAnchor(view, figure.feet),
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

  const apply = (people: readonly OfficePerson[], now: Date): void => {
    if (destroyed) return;
    const light = lightAt(now);
    const keys = new Set(people.map((person) => person.roleKey));
    const first = floor === null;
    if (!floor) {
      const layout = layoutOffice(people);
      const geometry = officeGeometryOf(layout);
      floor = {
        layout,
        amenities: amenitiesOf(layout),
        geometry,
        bounds: officeBounds(layout, geometry),
        people: keys,
        placements: new Map(),
      };
    } else {
      // A hire takes a desk and someone let go leaves theirs empty; nobody else moves.
      const widthBefore = floor.layout.width;
      for (const person of people)
        if (!floor.people.has(person.roleKey)) addHire(floor.layout, person);
      for (const roleKey of floor.people) if (!keys.has(roleKey)) letGo(floor.layout, roleKey);
      floor.people = keys;
      if (floor.layout.width !== widthBefore) {
        floor.geometry = officeGeometryOf(floor.layout);
        floor.bounds = officeBounds(floor.layout, floor.geometry);
        floor.amenities = amenitiesOf(floor.layout);
      }
    }
    floor.placements = placementsOf(people, floor.layout, floor.amenities, light, now);
    scene.build({
      layout: floor.layout,
      amenities: floor.amenities,
      geometry: floor.geometry,
      people: new Map(people.map((person) => [person.roleKey, person])),
      lookStates: lookStatesOf(people, now, light),
      placements: floor.placements,
      light,
    });
    if (first || view.framing.kind === "office") setView(fitView(view, floor.bounds));
    else setView(view);
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

/** The canvas's CSS box: its parent's, which the canvas fills, so autoDensity's inline size doesn't feed back. */
function boxOf(canvas: HTMLCanvasElement): { width: number; height: number } {
  const box = canvas.parentElement ?? canvas;
  return { width: Math.round(box.clientWidth), height: Math.round(box.clientHeight) };
}
