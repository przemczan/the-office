import { useQuery } from "@tanstack/react-query";
import { threadQueries } from "../../api/conversations.ts";
import { roleQueries } from "../../api/people.ts";
import { useTabVisible } from "../use-tab-visible.ts";
import { withoutThreadShown, type ChatPerson } from "./chat-words.ts";
import { useChat } from "./use-chat.tsx";

/**
 * The hired people with chat on, in the Roles' own order so that a row never moves under the
 * pointer, each with where their chat stands. A Thread showing in a visible tab is being read, so
 * its answer doesn't show as waiting for the moment before the service hears it was seen.
 */
export function useChatPeople(): readonly ChatPerson[] {
  const roles = useQuery(roleQueries.list()).data ?? [];
  const activity = useQuery(threadQueries.chatActivity()).data ?? [];
  const threadShown = useThreadShown();
  return roles
    .filter(({ letGoAt, card }) => letGoAt === null && card.capabilities.chat)
    .map((role) => ({
      role,
      activity: withoutThreadShown(
        activity.find(({ roleKey }) => roleKey === role.key),
        threadShown,
      ),
    }));
}

/** The Thread on screen in the open drawer, in a browser tab the user can see. */
export function useThreadShown(): string | undefined {
  const { isOpen, onThreadList, threadId } = useChat();
  const visible = useTabVisible();
  return isOpen && !onThreadList && visible ? threadId : undefined;
}
