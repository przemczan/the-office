import { CORE_AREA, type OfficeTool, type ToolArea } from "../ports/office-tool.js";

/** The areas a session loads from the start besides Core: its home's, or every one for a Stage. */
export type HomeAreas = readonly ToolArea[] | "all";

/** The Office tools a session loads from the start, and those it reaches on demand. */
export interface SplitOfficeTools {
  readonly loaded: readonly OfficeTool[];
  readonly reachable: readonly OfficeTool[];
}

/** Splits a session's allowed tools by area: Core and the home's areas load, the rest are reached. */
export function splitByArea(tools: readonly OfficeTool[], homeAreas: HomeAreas): SplitOfficeTools {
  const isLoaded = ({ area }: OfficeTool) =>
    homeAreas === "all" || area === CORE_AREA || homeAreas.includes(area);
  return { loaded: tools.filter(isLoaded), reachable: tools.filter((tool) => !isLoaded(tool)) };
}
