import { z } from "zod";
import type { EndpointTool } from "../../claude-code-p/local-endpoints.ts";

export const HANDOVER_NOTE = "handover_note";

/** An Office tool on the stand-in endpoint, recording each note it is handed. */
export function handoverNoteTool(notes: string[]): EndpointTool {
  return {
    name: HANDOVER_NOTE,
    description: "Saves the Agent's handover note on the Task.",
    input: { note: z.string() },
    run: async ({ note }) => {
      notes.push(String(note));
      return "Handover note saved.";
    },
  };
}
