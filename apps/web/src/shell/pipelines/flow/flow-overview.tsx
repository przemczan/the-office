import { type PointerEvent, type ReactNode, useRef } from "react";
import type { FlowOverviewShape } from "./flow-viewport-context.ts";
import type { FlowSize, FlowViewPoint, FlowZoomView } from "./flow-zoom.ts";

/** The Overview's largest size on the screen, in px. */
const MOST = { width: 200, height: 96 };

export interface FlowOverviewProps {
  readonly shape: FlowOverviewShape;
  /** The canvas's own size, the Overview's drawing space. */
  readonly content: FlowSize;
  readonly frame: FlowSize;
  readonly view: FlowZoomView;
  /** A press or a drag asks for the view centred on that point of the canvas. */
  readonly onCentre: (point: FlowViewPoint) => void;
}

/**
 * The Overview in the canvas's corner (docs/design/pipeline-editor.html, "The canvas"): the Stages
 * as blocks in their marks' colours, End, and the view as an ember frame; press or drag to move.
 */
export function FlowOverview({
  shape,
  content,
  frame,
  view,
  onCentre,
}: FlowOverviewProps): ReactNode {
  const svg = useRef<SVGSVGElement>(null);
  const scale = Math.min(MOST.width / content.width, MOST.height / content.height);
  const centreAt = (event: PointerEvent<SVGSVGElement>): void => {
    const box = svg.current?.getBoundingClientRect();
    if (!box) return;
    onCentre({ x: (event.clientX - box.left) / scale, y: (event.clientY - box.top) / scale });
  };
  return (
    <div
      className="flow-overview"
      role="group"
      aria-label="Overview: press or drag to move the view"
    >
      <svg
        ref={svg}
        width={Math.round(content.width * scale)}
        height={Math.round(content.height * scale)}
        viewBox={`0 0 ${content.width} ${content.height}`}
        aria-hidden="true"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.setPointerCapture?.(event.pointerId);
          centreAt(event);
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture?.(event.pointerId)) centreAt(event);
        }}
      >
        {shape.blocks.map(({ key, box, tone }) => (
          <rect
            key={key}
            className={`flow-overview-stage flow-overview-stage--${tone}`}
            x={box.x}
            y={box.y}
            width={box.width}
            height={box.height}
            rx={10}
          />
        ))}
        {shape.end && (
          <circle
            className="flow-overview-end"
            cx={shape.end.x + shape.end.width / 2}
            cy={shape.end.y + shape.end.height / 2}
            r={Math.min(shape.end.width, shape.end.height) / 2}
          />
        )}
        <rect
          className="flow-overview-view"
          x={-view.x / view.zoom}
          y={-view.y / view.zoom}
          width={frame.width / view.zoom}
          height={frame.height / view.zoom}
          rx={8}
        />
      </svg>
    </div>
  );
}
