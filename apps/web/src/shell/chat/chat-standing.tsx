import type { ReactNode } from "react";
import type { ChatStanding } from "./chat-words.ts";

export function StandingWords({ standing }: { readonly standing: ChatStanding }): ReactNode {
  return (
    <span className={`chat-standing ${standing.kind}`}>
      <StandingDot standing={standing} />
      {standing.words}
    </span>
  );
}

export function StandingDot({
  standing: { kind },
}: {
  readonly standing: ChatStanding;
}): ReactNode {
  return kind === "answered" || kind === "answering" ? (
    <span className={`chat-dot ${kind}`} />
  ) : null;
}
