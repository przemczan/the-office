import type { OfficeToolLoading } from "../../ports/agent-engine.js";

/**
 * Whether Claude Code's sessions load only Core and their home's Office tool areas from the start
 * and defer the rest to the engine's tool search (spec 5.4.1 › Loading by area). It ships off, until
 * the engine check's `office-tools.deferred` and `office-tools.deferred-p` items have passed
 * (docs/engine-check.md); with it off every allowed tool is loaded.
 */
export const CLAUDE_CODE_DEFERS_OFFICE_TOOLS = false;

/** How both Claude Code adapters load the Office tools a session isn't started with. */
export const CLAUDE_CODE_OFFICE_TOOL_LOADING: OfficeToolLoading = CLAUDE_CODE_DEFERS_OFFICE_TOOLS
  ? "deferred"
  : "all";
