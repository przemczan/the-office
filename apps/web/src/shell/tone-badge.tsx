import { Badge } from "@the-office/ui";
import type { ReactNode } from "react";
import type { ToneWords } from "./tone-words.ts";

/** A status as a small badge, with what it means on hover. */
export function ToneBadge({ words }: { readonly words: ToneWords }): ReactNode {
  return (
    <span title={words.title}>
      <Badge tone={words.tone} dot size="sm">
        {words.label}
      </Badge>
    </span>
  );
}
