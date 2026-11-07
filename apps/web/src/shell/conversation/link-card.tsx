import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import type { Message, Thread } from "@the-office/contracts";
import { Badge, Button, Icon } from "@the-office/ui";
import type { ReactNode } from "react";
import { startChatThread, threadQueries } from "../../api/conversations.ts";
import { nowQueries } from "../../api/notifications.ts";
import { roleQueries } from "../../api/people.ts";
import { useChat } from "../chat/use-chat.tsx";
import { MarkdownText } from "../markdown-text.tsx";
import { PersonAvatar } from "../person-avatar.tsx";
import { personName } from "../person-name.ts";
import { RecordMention } from "../record-mention.tsx";
import { RefusalAlert } from "../refusal-alert.tsx";
import { useHandoverNotes } from "./handover-notes.tsx";
import { personStatus } from "./link-card-words.ts";
import "./conversation.css";

type LinkCardMessage = Extract<Message, { kind: "link-card" }>;

/**
 * The Office Manager points the user to whoever is responsible (spec §2.2): the person, what they
 * are on now or that they were let go, and the Handover note. Opening the Thread starts a new one
 * in their chat with the note prefilled, for the user to edit or leave out and send themselves.
 */
export function LinkCard({ card }: { readonly card: LinkCardMessage }): ReactNode {
  const role = useQuery(roleQueries.one(card.to.roleKey)).data;
  const running = useQuery(nowQueries.now()).data?.running ?? [];
  const opening = useOpening(card);
  const name = role ? personName(role) : card.to.roleKey;
  const firstName = role?.card.name ?? card.to.roleKey;
  return (
    <section className="message link-card" aria-label={`Link card: ${name}`}>
      <div className="link-card-head">
        <PersonAvatar roleKey={card.to.roleKey} name={firstName} size="sm" />
        <div className="link-card-person">
          <span className="link-card-name">{name}</span>
          <span className="link-card-status">
            {card.to.letGo ? "Let go" : personStatus(card.to.roleKey, running)}
          </span>
        </div>
        {card.taskId !== null && (
          <span className="link-card-task">
            About <RecordMention link={{ kind: "task", taskId: card.taskId }} written="the Task" />
          </span>
        )}
      </div>
      <div className="link-card-note">
        <div className="link-card-note-label">
          <Icon name="sticky-note" size={12} />
          Handover note
        </div>
        <MarkdownText text={card.note} />
      </div>
      <div className="proposal-foot">
        {card.to.letGo ? (
          <Badge tone="neutral">{name} was let go</Badge>
        ) : (
          <>
            <Button
              size="sm"
              loading={opening.isPending && opening.variables}
              disabled={opening.isPending}
              onClick={() => opening.mutate(true)}
            >
              Open a thread with {firstName}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              loading={opening.isPending && !opening.variables}
              disabled={opening.isPending}
              onClick={() => opening.mutate(false)}
            >
              Open it without the note
            </Button>
          </>
        )}
        {opening.error && <RefusalAlert title="No new Thread" error={opening.error} />}
      </div>
    </section>
  );
}

/**
 * Starts a new Thread in the person's chat and shows it, leaving the Handover note in its composer
 * when `withNote`. The Office Manager never sends it: the user does.
 */
function useOpening(card: LinkCardMessage): UseMutationResult<Thread, Error, boolean> {
  const chat = useChat();
  const handoverNotes = useHandoverNotes();
  const queryClient = useQueryClient();
  const to = card.to.roleKey;
  return useMutation({
    mutationFn: (_withNote: boolean) => startChatThread(to),
    onSuccess: async (thread, withNote) => {
      if (withNote) handoverNotes.leave(thread.id, { text: card.note, from: card.roleKey });
      queryClient.setQueryData(threadQueries.one(thread.id).queryKey, thread);
      await queryClient.invalidateQueries(threadQueries.inChat(to));
      chat.open(to, thread.id);
    },
  });
}
