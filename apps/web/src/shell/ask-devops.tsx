import type { ReactNode } from "react";
import type { Role } from "@the-office/contracts";
import { AskInChatButton, useAskInChat, type AskInChat } from "./chat/ask-in-chat.tsx";
import { useHired } from "./use-hired.ts";

/**
 * Devops' Role, by the preset's fixed key: they onboard Projects, propose Project commands,
 * library Pipelines and Stage templates, and install skills from a Source.
 */
const DEVOPS = "devops";

/** Asks Devops from a page, with `draft` waiting in a new Thread of their chat (spec §2.3). */
export function AskDevopsButton({
  label,
  draft,
}: {
  readonly label: (name: string) => string;
  readonly draft: string;
}): ReactNode {
  return <AskInChatButton roleKey={DEVOPS} label={label} draft={draft} />;
}

/** Whoever fills Devops' Role now; undefined while nobody does. */
export function useDevops(): Role | undefined {
  return useHired(DEVOPS);
}

/** Asking Devops from a page, for a button of the page's own; `onAsked` runs as their chat opens. */
export function useAskDevops(onAsked?: () => void): AskInChat {
  return useAskInChat(DEVOPS, onAsked);
}
