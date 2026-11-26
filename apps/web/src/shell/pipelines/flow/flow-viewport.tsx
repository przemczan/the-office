import { Icon, IconButton, Menu, Tooltip } from "@the-office/ui";
import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { type FlowBox, orientationFor } from "./flow-layout.ts";
import { FlowOverview } from "./flow-overview.tsx";
import {
  type FlowOverviewShape,
  FlowViewportContext,
  type FlowViewportLink,
} from "./flow-viewport-context.ts";
import { useOverviewChoice } from "./use-overview-choice.ts";
import {
  AT_START,
  centredOn,
  clampedView,
  fittedView,
  type FlowSize,
  type FlowZoomView,
  namesOnlyAt,
  overflows,
  pannedBy,
  steppedZoom,
  viewportHeight,
  withBoxInView,
  ZOOM_MAX,
  ZOOM_MIN,
  zoomedAround,
} from "./flow-zoom.ts";
import "./flow-viewport.css";

export interface FlowViewportProps {
  /** In full screen there is no page to scroll, so a plain scroll moves the view. */
  readonly fullScreen?: boolean;
  /** Without it, there is no full screen button. */
  readonly onFullScreen?: (on: boolean) => void;
  /** The canvas, drawn at its own size and moved and scaled here. */
  readonly children: ReactNode;
}

const NO_SIZE: FlowSize = { width: 0, height: 0 };
/** How far an arrow key moves the view, in px. */
const KEY_STEP = 80;
/** How near the edge a drag makes the view follow, and how far each move takes it, in px. */
const FOLLOW_EDGE = 36;
const FOLLOW_STEP = 14;

/**
 * Around the flow canvas (docs/design/pipeline-editor.html, "The canvas"): it pans with the right or
 * middle mouse button, Space + drag or a drag on the empty canvas, zooms from 25% to 100% with Ctrl/⌘
 * + scroll or its controls, fits the whole Pipeline, and shows an Overview while the Pipeline doesn't
 * fit. A plain vertical scroll stays the page's, except in full screen. It owns its view and nothing
 * of the Pipeline: it opens at 100% with the Start in view, and a host opening another Pipeline gives
 * it a new key.
 */
export function FlowViewport(props: FlowViewportProps): ReactNode {
  const { fullScreen = false } = props;
  const frame = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<FlowZoomView>(AT_START);
  const [frameSize, setFrameSize] = useState<FlowSize>(NO_SIZE);
  const [contentSize, setContentSize] = useState<FlowSize>(NO_SIZE);
  const [fullHeight, setFullHeight] = useState(0);
  const [shape, setShape] = useState<FlowOverviewShape | undefined>();
  const [overviewOn, chooseOverview] = useOverviewChoice();
  const [panning, setPanning] = useState(false);
  const spaceHeld = useSpaceOver(frame);
  // Fit holds while the user hasn't moved the view by hand, so an edit or names-only refits.
  const fitted = useRef(false);
  // What the listeners and the canvas's calls read between renders.
  const sizes = useRef({ frame: NO_SIZE, content: NO_SIZE });
  const namesOnly = namesOnlyAt(view.zoom);
  const showsNamesOnly = useRef(namesOnly);
  useLayoutEffect(() => {
    sizes.current = { frame: frameSize, content: contentSize };
    showsNamesOnly.current = namesOnly;
  });

  const change = useCallback((next: (last: FlowZoomView) => FlowZoomView, byFit = false) => {
    fitted.current = byFit;
    setView(next);
  }, []);
  const fit = useCallback(() => {
    change(() => fittedView(sizes.current.frame, sizes.current.content), true);
  }, [change]);

  useElementSize(frame, setFrameSize, "client");
  // The viewport is as tall as the Pipeline with its full cards, which names-only would shrink.
  const onContentSize = useCallback((size: FlowSize) => {
    setContentSize(size);
    if (!showsNamesOnly.current && size.height > 0) setFullHeight(size.height);
  }, []);
  useElementSize(content, onContentSize, "offset");
  // A resize, an edit or a card's change of look moves what fits.
  useLayoutEffect(() => {
    setView((last) =>
      fitted.current
        ? fittedView(frameSize, contentSize)
        : clampedView(last, frameSize, contentSize),
    );
  }, [frameSize, contentSize]);
  useWheel(frame, fullScreen, sizes, change);

  const orientation = orientationFor(frameSize.width);
  const link = useMemo<FlowViewportLink>(
    () => ({
      namesOnly,
      orientation,
      width: frameSize.width,
      zoom: view.zoom,
      fit,
      shiftBy: (dx, dy) =>
        setView((last) => ({ ...last, x: last.x + dx * last.zoom, y: last.y + dy * last.zoom })),
      showOverview: (next) =>
        setShape((last) => (JSON.stringify(last) === JSON.stringify(next) ? last : next)),
      bringIntoView: (box: FlowBox) =>
        change((last) => withBoxInView(last, box, sizes.current.frame, sizes.current.content)),
      followDrag: ({ clientX, clientY }) => {
        const box = frame.current?.getBoundingClientRect();
        if (!box) return;
        const dx = followAlong(clientX, box.left, box.right);
        const dy = followAlong(clientY, box.top, box.bottom);
        if (dx !== 0 || dy !== 0)
          change((last) => pannedBy(last, dx, dy, sizes.current.frame, sizes.current.content));
      },
    }),
    [namesOnly, orientation, frameSize.width, view.zoom, fit, change],
  );

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if ((event.target as Element).closest(".flow-viewport-tools, .flow-overview")) return;
    const pans =
      event.button === 1 ||
      event.button === 2 ||
      (event.button === 0 && (spaceHeld || onEmptyCanvas(event.target as Element)));
    if (!pans) return;
    // Taken before the canvas sees it: a Stage or a handle under Space + drag would start its own
    // drag, which loses its pointer to this capture and never hears the release.
    event.stopPropagation();
    event.preventDefault();
    frame.current?.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const start = { x: event.clientX, y: event.clientY, view };
    setPanning(true);
    const element = event.currentTarget;
    const move = (moved: globalThis.PointerEvent): void => {
      change(() =>
        pannedBy(
          start.view,
          moved.clientX - start.x,
          moved.clientY - start.y,
          sizes.current.frame,
          sizes.current.content,
        ),
      );
    };
    const end = (): void => {
      setPanning(false);
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", end);
      element.removeEventListener("pointercancel", end);
    };
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", end);
    element.addEventListener("pointercancel", end);
  };

  const step = (direction: 1 | -1): void => {
    const zoom = steppedZoom(view.zoom, direction);
    if (zoom !== undefined) zoomTo(zoom);
  };
  const pan = (dx: number, dy: number): void =>
    change((last) => pannedBy(last, dx, dy, frameSize, contentSize));
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.target !== event.currentTarget) return;
    const keys: Record<string, () => void> = {
      "+": () => step(1),
      "=": () => step(1),
      "-": () => step(-1),
      "0": () => zoomTo(ZOOM_MAX),
      f: fit,
      F: fit,
      ArrowLeft: () => pan(KEY_STEP, 0),
      ArrowRight: () => pan(-KEY_STEP, 0),
      ArrowUp: () => pan(0, KEY_STEP),
      ArrowDown: () => pan(0, -KEY_STEP),
    };
    const act = keys[event.key];
    if (!act || event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault();
    act();
  };

  const zoomTo = (zoom: number): void => {
    const middle = { x: frameSize.width / 2, y: frameSize.height / 2 };
    change((last) => zoomedAround(last, zoom, middle, frameSize, contentSize));
  };

  const shows = overflows(view, frameSize, contentSize);
  // A flow running down has no room beside the controls for an Overview.
  const overviewFits = orientation === "across";
  const style = {
    height: fullScreen ? undefined : viewportHeight(fullHeight, window.innerHeight),
  } satisfies CSSProperties;
  const contentStyle = {
    transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
    "--flow-name-size": `${Math.min(13 / view.zoom, 32)}px`,
  } as CSSProperties;
  return (
    <div className="flow-viewport">
      <div
        ref={frame}
        // The canvas inside is the Flow region; this is what moves it, by keys while focused.
        role="group"
        aria-label="Flow view: arrow keys move it, + and − zoom, F fits the Pipeline"
        tabIndex={0}
        className={`flow-viewport-frame${spaceHeld ? " flow-viewport-frame--space" : ""}${panning ? " flow-viewport-frame--panning" : ""}`}
        style={style}
        onPointerDownCapture={onPointerDown}
        onContextMenu={(event) => event.preventDefault()}
        // The middle button pans here, not the browser's autoscroll.
        onMouseDown={(event) => event.button === 1 && event.preventDefault()}
        onKeyDown={onKeyDown}
        // Focus moving to a Stage scrolls a box even with its overflow hidden: the view moves instead.
        onScroll={(event) => {
          const { scrollLeft, scrollTop } = event.currentTarget;
          if (scrollLeft === 0 && scrollTop === 0) return;
          event.currentTarget.scrollTo(0, 0);
          change((last) => pannedBy(last, -scrollLeft, -scrollTop, frameSize, contentSize));
        }}
      >
        <div ref={content} className="flow-viewport-content" style={contentStyle}>
          <FlowViewportContext.Provider value={link}>{props.children}</FlowViewportContext.Provider>
        </div>
        {shows && overviewFits && overviewOn && shape && (
          <FlowOverview
            shape={shape}
            content={contentSize}
            frame={frameSize}
            view={view}
            onCentre={(point) =>
              change((last) => centredOn(last, point, sizes.current.frame, sizes.current.content))
            }
          />
        )}
      </div>
      <ViewportTools
        zoom={view.zoom}
        overflows={shows}
        overviewFits={overviewFits}
        overviewOn={overviewOn}
        fullScreen={fullScreen}
        onZoom={zoomTo}
        onStep={step}
        onFit={fit}
        onOverview={() => chooseOverview(!overviewOn)}
        onFullScreen={props.onFullScreen}
      />
    </div>
  );
}

function followAlong(at: number, start: number, end: number): number {
  if (at < start + FOLLOW_EDGE) return FOLLOW_STEP;
  if (at > end - FOLLOW_EDGE) return -FOLLOW_STEP;
  return 0;
}

/**
 * A press there moves the view rather than picking or dragging something. A pressable ≤N× mark
 * picks its route, so it is no empty canvas; a mark that isn't pressable is.
 */
function onEmptyCanvas(target: Element): boolean {
  return (
    target.closest(
      "[data-flow-stage], [data-flow-route], [data-flow-end], .flow-canvas-limit-mark--pressable, button, a, input",
    ) === null
  );
}

interface ViewportToolsProps {
  readonly zoom: number;
  readonly overflows: boolean;
  /** Whether the canvas has room for the Overview: it hasn't while the flow runs down. */
  readonly overviewFits: boolean;
  readonly overviewOn: boolean;
  readonly fullScreen: boolean;
  readonly onZoom: (zoom: number) => void;
  readonly onStep: (direction: 1 | -1) => void;
  readonly onFit: () => void;
  readonly onOverview: () => void;
  readonly onFullScreen: ((on: boolean) => void) | undefined;
}

/** The canvas's controls over its lower-left corner: −, the % menu, +, Fit, Overview, full screen. */
function ViewportTools(props: ViewportToolsProps): ReactNode {
  const { zoom } = props;
  const [menuOpen, setMenuOpen] = useState(false);
  const smallest = zoom <= ZOOM_MIN + 0.001;
  const largest = zoom >= ZOOM_MAX - 0.001;
  return (
    <div className="flow-viewport-tools" role="toolbar" aria-label="Canvas">
      <ToolButton
        icon="minus"
        label="Zoom out"
        tip={smallest ? "Already at 25%, the smallest" : "Zoom out (−)"}
        disabled={smallest}
        onClick={() => props.onStep(-1)}
      />
      <Menu
        open={menuOpen}
        onOpenChange={setMenuOpen}
        align="start"
        width={200}
        trigger={
          <button
            type="button"
            className="flow-viewport-readout"
            aria-label={`Zoom: ${Math.round(zoom * 100)}%`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            {Math.round(zoom * 100)}%
          </button>
        }
        items={[
          { label: "Fit the Pipeline", shortcut: "F", onSelect: props.onFit },
          { divider: true },
          { label: "100%", shortcut: "0", onSelect: () => props.onZoom(1) },
          { label: "75%", onSelect: () => props.onZoom(0.75) },
          { label: "50%", onSelect: () => props.onZoom(0.5) },
          { label: "25%", onSelect: () => props.onZoom(0.25) },
        ]}
      />
      <ToolButton
        icon="plus"
        label="Zoom in"
        tip={largest ? "Already at 100%, a Stage's own size" : "Zoom in (+)"}
        disabled={largest}
        onClick={() => props.onStep(1)}
      />
      <span className="flow-viewport-tools-gap" />
      <ToolButton
        icon="scan"
        label="Fit the Pipeline"
        tip="Fit the Pipeline (F)"
        onClick={props.onFit}
      />
      {props.overviewFits && (
        <ToolButton
          icon="map"
          label="Overview"
          tip={
            !props.overflows
              ? "The whole Pipeline is in view"
              : props.overviewOn
                ? "Hide the Overview"
                : "Show the Overview"
          }
          pressed={props.overviewOn}
          disabled={!props.overflows}
          onClick={props.onOverview}
        />
      )}
      {props.onFullScreen && (
        <>
          <span className="flow-viewport-tools-gap" />
          <ToolButton
            icon={props.fullScreen ? "minimize-2" : "maximize-2"}
            label={props.fullScreen ? "Exit full screen" : "Full screen"}
            tip={props.fullScreen ? "Exit full screen (Esc)" : "Full screen"}
            onClick={() => props.onFullScreen?.(!props.fullScreen)}
          />
        </>
      )}
    </div>
  );
}

function ToolButton(props: {
  readonly icon: string;
  readonly label: string;
  readonly tip: string;
  readonly disabled?: boolean;
  readonly pressed?: boolean;
  readonly onClick: () => void;
}): ReactNode {
  return (
    <Tooltip content={props.tip} side="top">
      <IconButton
        icon={<Icon name={props.icon} size={14} />}
        label={props.label}
        size="sm"
        variant="ghost"
        aria-disabled={props.disabled ? true : undefined}
        aria-pressed={props.pressed}
        onClick={() => {
          if (!props.disabled) props.onClick();
        }}
      />
    </Tooltip>
  );
}

/** An element's size as laid out (offset: its own, unscaled by a transform), kept up to date. */
function useElementSize(
  element: RefObject<HTMLElement | null>,
  onSize: (size: FlowSize) => void,
  box: "client" | "offset",
): void {
  useLayoutEffect(() => {
    const observed = element.current;
    if (!observed) return undefined;
    const read = (): void => {
      const width = box === "client" ? observed.clientWidth : observed.offsetWidth;
      const height = box === "client" ? observed.clientHeight : observed.offsetHeight;
      onSize({ width, height });
    };
    read();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(read);
    observer.observe(observed);
    return () => observer.disconnect();
  }, [element, onSize, box]);
}

/** Ctrl/⌘ + scroll zooms around the pointer; a sideways scroll pans, and in full screen any scroll. */
function useWheel(
  frame: RefObject<HTMLDivElement | null>,
  fullScreen: boolean,
  sizes: RefObject<{ frame: FlowSize; content: FlowSize }>,
  change: (next: (last: FlowZoomView) => FlowZoomView) => void,
): void {
  useEffect(() => {
    const element = frame.current;
    if (!element) return undefined;
    const onWheel = (event: WheelEvent): void => {
      const { frame: frameSize, content } = sizes.current;
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const box = element.getBoundingClientRect();
        const point = { x: event.clientX - box.left, y: event.clientY - box.top };
        change((last) =>
          zoomedAround(
            last,
            last.zoom * Math.exp(-event.deltaY * 0.0022),
            point,
            frameSize,
            content,
          ),
        );
        return;
      }
      const sideways = event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY);
      if (!fullScreen && !sideways) return;
      event.preventDefault();
      const dx = event.shiftKey && event.deltaX === 0 ? event.deltaY : event.deltaX;
      const dy = fullScreen && !event.shiftKey ? event.deltaY : 0;
      change((last) => pannedBy(last, -dx, -dy, frameSize, content));
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [frame, fullScreen, sizes, change]);
}

/** Whether Space is held while the pointer is over the canvas, which makes a left drag pan. */
function useSpaceOver(frame: RefObject<HTMLElement | null>): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    const element = frame.current;
    if (!element) return undefined;
    let over = false;
    const enter = (): void => {
      over = true;
    };
    const leave = (): void => {
      over = false;
    };
    const down = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== " " || !over) return;
      const target = event.target as Element | null;
      if (target?.closest?.("input, textarea, select, button, [contenteditable]")) return;
      event.preventDefault();
      setHeld(true);
    };
    const up = (event: globalThis.KeyboardEvent): void => {
      if (event.key === " ") setHeld(false);
    };
    element.addEventListener("pointerenter", enter);
    element.addEventListener("pointerleave", leave);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      element.removeEventListener("pointerenter", enter);
      element.removeEventListener("pointerleave", leave);
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [frame]);
  return held;
}
