import type { OfficeToolResult } from "../../../engine/index.js";
import { ProposalRefused } from "../../domain/proposal-refused.js";

/** Drafts with `draft`, answering the Agent with what it says, or with why it was refused. */
export async function refusedToTheAgent(draft: () => Promise<string>): Promise<OfficeToolResult> {
  try {
    return { text: await draft(), isError: false };
  } catch (error) {
    if (error instanceof ProposalRefused) return { text: error.message, isError: true };
    throw error;
  }
}
