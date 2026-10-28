import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, Icon } from "@the-office/ui";
import type { ReactNode } from "react";
import { startChatThread, threadQueries } from "../../api/conversations.ts";
import { useThreadDrafts } from "../conversation/thread-drafts.tsx";
import { RefusalAlert } from "../refusal-alert.tsx";
import { useHired } from "../use-hired.ts";
import { useChat } from "./use-chat.ts";

/**
 * Asks the person who fills the Role from a page, as the click-through's "Ask Nina" does: a new
 * Thread in their chat, opened with `draft` in its composer for the user to finish and send. Shown
 * only while someone with a chat fills the Role.
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
  const person = useHired(roleKey);
  const chat = useChat();
  const drafts = useThreadDrafts();
  const queryClient = useQueryClient();
  const opening = useMutation({
    mutationFn: () => startChatThread(roleKey),
    onSuccess: async (thread) => {
      drafts.leave(thread.id, draft);
      queryClient.setQueryData(threadQueries.one(thread.id).queryKey, thread);
      await queryClient.invalidateQueries(threadQueries.inChat(roleKey));
      chat.open(roleKey, thread.id);
    },
  });
  if (!person?.card.capabilities.chat) return null;
  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        iconLeft={<Icon name="message-circle" size={14} />}
        loading={opening.isPending}
        onClick={() => opening.mutate()}
      >
        {label(person.card.name)}
      </Button>
      {opening.error && <RefusalAlert title="No new Thread" error={opening.error} />}
    </>
  );
}
