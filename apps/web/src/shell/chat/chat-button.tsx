import { Avatar, Button, Icon } from "@the-office/ui";
import type { ReactNode } from "react";
import { chatButtonLook, chatButtonWords, type ChatButtonLook } from "./chat-words.ts";
import { useChatPeople } from "./use-chat-people.ts";
import { useChat } from "./use-chat.tsx";

/** Where focus goes back to as the drawer closes. */
export const CHAT_BUTTON_ELEMENT_ID = "chat-button";

/**
 * Opens the chat drawer from any page, on the newest answer waiting, or else where the user left
 * off. It shows a face and a dot, never a number, so it can't read as the Needs you count.
 */
export function ChatButton(): ReactNode {
  const chat = useChat();
  const look = chatButtonLook(useChatPeople());
  const words = chatButtonWords(look);
  const openChat = (): void => {
    if (look.kind === "answered") chat.open(look.roleKey, look.threadId);
    else chat.open();
  };
  return (
    <Button
      id={CHAT_BUTTON_ELEMENT_ID}
      className="chat-button"
      variant="secondary"
      aria-label={words}
      aria-expanded={chat.isOpen}
      title={words}
      onClick={chat.isOpen ? chat.close : openChat}
    >
      <ChatMark look={look} />
      <span className="shell-top-words">Chat</span>
    </Button>
  );
}

function ChatMark({ look }: { readonly look: ChatButtonLook }): ReactNode {
  switch (look.kind) {
    case "nothing-new":
      return <Icon name="message-circle" size={14} />;
    case "answering":
      return (
        <span className="chat-mark">
          <Avatar name={look.person.card.name} size="xs" />
          <span className="chat-dot answering" />
        </span>
      );
    case "answered":
      return (
        <span className="chat-mark">
          {look.people.map(({ key, card }) => (
            <Avatar key={key} name={card.name} size="xs" />
          ))}
          <span className="chat-dot answered" />
        </span>
      );
  }
}
