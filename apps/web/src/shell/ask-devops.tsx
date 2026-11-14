import type { ReactNode } from "react";
import type { Role } from "@the-office/contracts";
import { AskInChatButton, useAskInChat, type AskInChat } from "./chat/ask-in-chat.tsx";
import { DutyUnheldNote } from "./duty-unheld-note.tsx";
import { useDutyHolder } from "./use-duty-holder.ts";

/**
 * Asks whoever holds Onboards and repairs Projects from a page, with `draft` waiting in a new
 * Thread of their chat (spec §2.3): they onboard Projects, propose Project commands, library
 * Pipelines and Stage templates, and install skills from a Source. While nobody holds it, the page
 * says so.
 */
export function AskDevopsButton({
  label,
  draft,
}: {
  readonly label: (name: string) => string;
  readonly draft: string;
}): ReactNode {
  const holder = useDevops();
  if (holder) return <AskInChatButton roleKey={holder.key} label={label} draft={draft} />;
  return <DutyUnheldNote duty="onboards-projects" />;
}

/** Whoever holds Onboards and repairs Projects now; undefined while nobody does. */
export function useDevops(): Role | undefined {
  return useDutyHolder("onboards-projects").holder;
}

/**
 * Asking whoever holds Onboards and repairs Projects from a page, for a button of the page's own;
 * `onAsked` runs as their chat opens.
 */
export function useAskDevops(onAsked?: () => void): AskInChat {
  return useAskInChat(useDevops()?.key, onAsked);
}
