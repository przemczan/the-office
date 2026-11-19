import { type RefObject, useLayoutEffect, useState } from "react";
import type { FlowBox, FlowMeasure, FlowOrientation, MeasuredStage } from "./flow-layout.ts";

export interface FlowView {
  /** The canvas's own size, unscaled by the viewport's zoom; 0 until it is laid out. */
  readonly width: number;
  readonly height: number;
  readonly measure: FlowMeasure;
}

const NOTHING_MEASURED: FlowView = {
  width: 0,
  height: 0,
  measure: { stages: new Map(), end: undefined },
};

/**
 * The canvas's size and its Stages' and End's boxes, measured after every render (the lines follow
 * what was drawn) and whenever the canvas is resized; a measure that hasn't changed keeps the last,
 * so measuring never renders again for nothing. Boxes are in the canvas's own pixels, whatever the
 * viewport's zoom.
 */
export function useFlowMeasure(
  canvas: RefObject<HTMLElement | null>,
  orientation: FlowOrientation,
): FlowView {
  const [view, setView] = useState<FlowView>(NOTHING_MEASURED);
  // After every render, as the lines follow what was just drawn, and on every resize.
  useLayoutEffect(() => {
    const element = canvas.current;
    if (!element) return undefined;
    const remeasure = (): void => {
      const next = measured(element, orientation);
      setView((last) => (sameView(last, next) ? last : next));
    };
    remeasure();
    const observer = new ResizeObserver(remeasure);
    observer.observe(element);
    return () => observer.disconnect();
  });
  return view;
}

/** The boxes, the routes' rows along the edge their ports are on for the canvas's orientation. */
function measured(canvas: HTMLElement, orientation: FlowOrientation): FlowView {
  const origin = canvas.getBoundingClientRect();
  const scale = scaleOf(canvas, origin);
  const ox = origin.left + canvas.clientLeft * scale;
  const oy = origin.top + canvas.clientTop * scale;
  const boxOf = (element: Element): FlowBox => {
    const rect = element.getBoundingClientRect();
    return {
      x: (rect.left - ox) / scale,
      y: (rect.top - oy) / scale,
      width: rect.width / scale,
      height: rect.height / scale,
    };
  };
  const stages = new Map<string, MeasuredStage>();
  for (const card of canvas.querySelectorAll<HTMLElement>("[data-flow-stage]")) {
    const rows = [...card.querySelectorAll("[data-flow-route-row]")].map(boxOf);
    stages.set(card.dataset.flowStage ?? "", {
      box: boxOf(card),
      rowCentres: rows.map((row) =>
        orientation === "across" ? row.y + row.height / 2 : row.x + row.width / 2,
      ),
    });
  }
  const end = canvas.querySelector("[data-flow-end]");
  return {
    width: canvas.clientWidth,
    height: canvas.clientHeight,
    measure: { stages, end: end ? boxOf(end) : undefined },
  };
}

/** How much the viewport scales the canvas on the screen: its drawn width over its own. */
export function scaleOf(
  canvas: HTMLElement,
  rect: DOMRect = canvas.getBoundingClientRect(),
): number {
  return canvas.offsetWidth > 0 && rect.width > 0 ? rect.width / canvas.offsetWidth : 1;
}

function sameView(a: FlowView, b: FlowView): boolean {
  return JSON.stringify(plain(a)) === JSON.stringify(plain(b));
}

function plain({ width, height, measure }: FlowView): unknown {
  return [width, height, [...measure.stages], measure.end];
}
