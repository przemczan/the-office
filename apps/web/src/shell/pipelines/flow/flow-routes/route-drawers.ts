import { curves } from "./curves.ts";
import { rightAngles } from "./right-angles.ts";
import type { RouteDrawer, RouteDrawing } from "./route-drawer.ts";
import { straightLines } from "./straight-lines.ts";

/** Every way of drawing the routes, by the name the Route drawing switch keeps. */
export const ROUTE_DRAWERS: Readonly<Record<RouteDrawing, RouteDrawer>> = {
  "right-angles": rightAngles,
  curves,
  "straight-lines": straightLines,
};
