import type { OfficeTool, OfficeToolCall, OfficeToolUser } from "./office-tool.js";

/**
 * What the ruling step makes of a call of an Office tool (spec 5.4.1 › One ruling step): it runs
 * now, with the user who allowed it when it was held for approval; it waits on approval or is
 * refused, in the words the Agent reads instead of the tool's answer; or its tool is ruled Never,
 * so the Agent is told no such tool exists.
 */
export type OfficeToolRuled =
  | { readonly kind: "run"; readonly allowedBy?: OfficeToolUser }
  | { readonly kind: "hold"; readonly words: string }
  | { readonly kind: "never" };

/**
 * The one ruling step every Office tool call passes, whatever its engine: the registry asks it
 * before it runs a tool, so no adapter can run one unruled. The module keeping Threads fills it
 * from the session's person and place, the way `ApprovalHold` is filled.
 */
export interface OfficeToolRuling {
  rule(
    call: OfficeToolCall,
    tool: Pick<OfficeTool, "name" | "authority">,
    input: unknown,
  ): Promise<OfficeToolRuled>;
}
