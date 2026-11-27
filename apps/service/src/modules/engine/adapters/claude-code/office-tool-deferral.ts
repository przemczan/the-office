import type { OfficeToolLoading } from "../../ports/agent-engine.js";

/**
 * Whether Claude Code's sessions load only Core and their home's Office tool areas from the start
 * and defer the rest to the engine's tool search (spec 5.4.1 › Loading by area); with it off every
 * allowed tool is loaded. On since the engine check's `office-tools.deferred` and
 * `office-tools.deferred-p` items passed (docs/engine-check.md), which a re-run checks again.
 */
export const CLAUDE_CODE_DEFERS_OFFICE_TOOLS = true;

/** How both Claude Code adapters load the Office tools a session isn't started with. */
export const CLAUDE_CODE_OFFICE_TOOL_LOADING: OfficeToolLoading = CLAUDE_CODE_DEFERS_OFFICE_TOOLS
  ? "deferred"
  : "all";
