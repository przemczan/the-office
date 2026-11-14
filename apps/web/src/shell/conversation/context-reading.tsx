import { Tooltip } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import type { ContextReadingLook, ReadingMeter, ReadingShown } from "./context-reading-words.ts";

const SHOWN_CLASS: Readonly<Record<ReadingShown, string | undefined>> = {
  always: undefined,
  wide: "context-reading-wide",
  "not-narrow": "context-reading-not-narrow",
  narrow: "context-reading-narrow",
};

/**
 * The row right above the message input, or the note saying why there is none: the Sub-agents and
 * processes line fills it from the left, and the context reading keeps its right end at its own
 * width, so neither moves the other.
 */
export function SessionRow({
  line,
  reading,
}: {
  readonly line: ReactNode;
  readonly reading: ReactNode;
}): ReactNode {
  if (!reading) return line;
  return (
    <div className="session-row">
      {line}
      <div className="context-reading-slot">{reading}</div>
    </div>
  );
}

/**
 * The session's context size against its model's window, with a meter whose mark stands where The
 * Office asks for a Handover note. It asks nothing, so it is no button; its Tooltip says it whole.
 */
export function ContextReading({ look }: { readonly look: ContextReadingLook }): ReactNode {
  const ticked = useChanged(look.parts.find(({ strong }) => strong)?.text);
  return (
    <Tooltip content={look.tip}>
      <span
        className="context-reading"
        data-near={look.near || undefined}
        data-quiet={look.quiet || undefined}
        role="img"
        aria-label={look.label}
        tabIndex={0}
      >
        <span className="context-reading-words" aria-hidden="true">
          {look.parts.map(({ text, strong, shown }) =>
            strong ? (
              <strong key={text} className={ticked ? "context-reading-ticked" : undefined}>
                {text}
              </strong>
            ) : (
              <span key={text} className={SHOWN_CLASS[shown]}>
                {text}
              </span>
            ),
          )}
        </span>
        {look.meter && <Meter meter={look.meter} />}
      </span>
    </Tooltip>
  );
}

function Meter({ meter }: { readonly meter: ReadingMeter }): ReactNode {
  return (
    <span className="context-meter" data-empty={meter.kind === "empty" || undefined}>
      {meter.kind === "filled" && (
        <span className="context-meter-fill" style={{ width: `${meter.share * 100}%` }} />
      )}
      {meter.mark && <span className="context-meter-mark" />}
    </span>
  );
}

/**
 * Whether a live reading changed the figure since it first showed: keyed by its text, the figure
 * is drawn anew at each change, and flashes softly then, never as it first shows.
 */
function useChanged(figure: string | undefined): boolean {
  const [first] = useState(figure);
  return first !== figure;
}
