import type { ChatActivity, Role } from "@the-office/contracts";
import { dayAndClockOf } from "../time.ts";

/** Where one person's chat stands. */
export type PersonActivity = ChatActivity[number];

/** A person offered in the chat, with where their chat stands; undefined with no Threads. */
export interface ChatPerson {
  readonly role: Role;
  readonly activity: PersonActivity | undefined;
}

/** What the person picker and the person switch say of someone's chat. */
export interface ChatStanding {
  readonly kind: "answered" | "answering" | "quiet" | "none";
  readonly words: string;
}

/** Answered wins over answering, as it is the one that waits on the user. */
export function chatStanding(activity: PersonActivity | undefined): ChatStanding {
  if (activity === undefined) return { kind: "none", words: "No Threads yet" };
  const [answer] = activity.answered;
  if (answer) return { kind: "answered", words: `Answered · ${dayAndClockOf(answer.at)}` };
  if (activity.answering) return { kind: "answering", words: "Answering…" };
  return { kind: "quiet", words: dayAndClockOf(activity.lastMovedAt) };
}

/** The Chat button's look: a face and a dot, never a number. */
export type ChatButtonLook =
  | { readonly kind: "nothing-new" }
  | { readonly kind: "answering"; readonly person: Role }
  | {
      readonly kind: "answered";
      /** Who answered, the latest first: two at most. */
      readonly people: readonly Role[];
      /** Where the button leads: the newest answer. */
      readonly roleKey: string;
      readonly threadId: string;
    };

const FACES_SHOWN = 2;

export function chatButtonLook(people: readonly ChatPerson[]): ChatButtonLook {
  const answers = people
    .flatMap(({ role, activity }) =>
      activity?.answered[0] ? [{ role, answer: activity.answered[0] }] : [],
    )
    .toSorted((first, second) => second.answer.at.localeCompare(first.answer.at));
  const [newest] = answers;
  if (newest) {
    return {
      kind: "answered",
      people: answers.slice(0, FACES_SHOWN).map(({ role }) => role),
      roleKey: newest.role.key,
      threadId: newest.answer.threadId,
    };
  }
  const answering = people.find(({ activity }) => activity?.answering);
  return answering ? { kind: "answering", person: answering.role } : { kind: "nothing-new" };
}

/** What the Chat button is called, for a screen reader and its tooltip. */
export function chatButtonWords(look: ChatButtonLook): string {
  switch (look.kind) {
    case "nothing-new":
      return "Chat: nothing new";
    case "answering":
      return `Chat: ${look.person.card.name} is answering`;
    case "answered":
      return `Chat: ${look.people.map(({ card }) => card.name).join(" and ")} answered`;
  }
}

/** A person's activity with the Thread on screen left out: its answer is being read. */
export function withoutThreadShown(
  activity: PersonActivity | undefined,
  threadShown: string | undefined,
): PersonActivity | undefined {
  return (
    activity && {
      ...activity,
      answered: activity.answered.filter(({ threadId }) => threadId !== threadShown),
    }
  );
}
