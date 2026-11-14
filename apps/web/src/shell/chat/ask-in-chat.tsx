import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Role } from "@the-office/contracts";
import { Button, Icon } from "@the-office/ui";
import type { ReactNode } from "react";
import { startChatThread, threadQueries } from "../../api/conversations.ts";
import { useThreadDrafts } from "../conversation/thread-drafts.tsx";
import { RefusalAlert } from "../refusal-alert.tsx";
import { useHired } from "../use-hired.ts";
import { useChat } from "./use-chat.tsx";

/** Asking the person who fills a Role in a new Thread of their chat, with a draft waiting. */
export interface AskInChat {
  /** Whoever fills the Role with a chat; undefined while nobody does. */
  readonly person: Role | undefined;
  /** Opens the new Thread with `draft` in its composer for the user to finish and send. */
  readonly ask: (draft: string) => void;
  readonly asking: boolean;
  readonly error: Error | null;
}

/** Asks the person who fills the Role from a page, as the click-through's "Ask Nina" does. */
export function useAskInChat(roleKey: string | undefined, onAsked?: () => void): AskInChat {
  const hired = useHired(roleKey);
  const person = hired?.card.capabilities.chat ? hired : undefined;
  const chat = useChat();
  const drafts = useThreadDrafts();
  const queryClient = useQueryClient();
  const opening = useMutation({
    mutationFn: (_draft: string) => startChatThread(asked(person)),
    onSuccess: async (thread, draft) => {
      drafts.leave(thread.id, draft);
      queryClient.setQueryData(threadQueries.one(thread.id).queryKey, thread);
      await queryClient.invalidateQueries(threadQueries.inChat(thread.roleKey));
      onAsked?.();
      chat.open(thread.roleKey, thread.id);
    },
  });
  return {
    person,
    ask: (draft) => opening.mutate(draft),
    asking: opening.isPending,
    error: opening.error,
  };
}

/**
 * Asks the person who fills the Role from a page: a new Thread in their chat, opened with `draft`
 * in its composer. Shown only while someone with a chat fills the Role.
 */
export function AskInChatButton({
  roleKey,
  label,
  draft,
}: {
  readonly roleKey: string;
  /** The button's words, from the person's name. */
  readonly label: (name: string) => string;
  readonly draft: string;
}): ReactNode {
  const { person, ask, asking, error } = useAskInChat(roleKey);
  if (!person) return null;
  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        iconLeft={<Icon name="message-circle" size={14} />}
        loading={asking}
        onClick={() => ask(draft)}
      >
        {label(person.card.name)}
      </Button>
      {error && <RefusalAlert title="No new Thread" error={error} />}
    </>
  );
}

/** The key of the person asked; asking is offered only while someone with a chat fills the Role. */
function asked(person: Role | undefined): string {
  if (!person) throw new Error("Nobody with a chat fills this Role.");
  return person.key;
}
