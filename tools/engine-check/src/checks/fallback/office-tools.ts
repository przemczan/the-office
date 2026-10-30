import { z } from "zod";
import type { OfficeTool } from "../../claude-code-p/office-tool-server.ts";

export const HANDOVER_NOTE = "handover_note";

/** An Office tool the check serves, recording each note it is handed. */
export function handoverNoteTool(notes: string[]): OfficeTool {
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
