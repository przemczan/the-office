import { useQuery } from "@tanstack/react-query";
import type { Now } from "@the-office/contracts";
import type { ReactNode } from "react";
import { nowQueries } from "../api/notifications.ts";
import { useEventStreamStatus } from "../api/event-stream-provider.tsx";
import { tokensShort } from "./conversation/context-words.ts";
import { doneSinceYouLeft, needsYouWords, resetWords } from "./notifications/now-words.ts";

/**
 * The Office-wide figures under the top bar (spec §4), live from `now.changed`: what needs the
 * user, desks in use, tokens today, the 5-hour window, Tasks touched and done since the user left.
 * While the web has lost the service it says so first.
 */
export function StatusStrip(): ReactNode {
  const reconnecting = useEventStreamStatus() === "reconnecting";
  const now = useQuery(nowQueries.now()).data;
  return (
    <div className="shell-strip" role="status" aria-label="Status strip">
      {reconnecting && (
        <span className="shell-strip-stat">
          <span className="shell-dot reconnecting" />
          Reconnecting to The Office…
        </span>
      )}
      {now && <Figures now={now} />}
    </div>
  );
}

function Figures({ now }: { readonly now: Now }): ReactNode {
  const fiveHour = now.fiveHourWindow;
  const resets = fiveHour && resetWords(fiveHour.resetsAt);
  return (
    <>
      <span className="shell-strip-stat">
        <b>{now.needsYou.length}</b> {needsYouWords(now.needsYou.length)}
      </span>
      <span className="shell-strip-stat">
        <span className={`shell-dot ${now.desks.inUse > 0 ? "running" : "idle"}`} />
        <b>{now.desks.inUse}</b>
        <span className="shell-strip-faint">/ {now.desks.limit}</span> desks in use
      </span>
      <span className="shell-strip-separator" />
      <span className="shell-strip-stat">
        <b>{tokensShort(now.tokensToday)}</b> tokens today
      </span>
      {fiveHour && (
        <span className="shell-strip-stat wide">
          <b>{Math.round(fiveHour.percentUsed)}%</b> of the 5-hour window
          <span className="shell-strip-meter" aria-hidden="true">
            <i style={{ width: `${Math.min(100, Math.max(0, fiveHour.percentUsed))}%` }} />
          </span>
          {resets && <span className="shell-strip-faint">{resets}</span>}
        </span>
      )}
      <span className="shell-strip-stat wide">
        <b>{now.tasksTouched}</b> Tasks touched
      </span>
      <span className="shell-strip-separator" />
      <span className="shell-strip-stat wide">
        <b>{doneSinceYouLeft(now)}</b> done since you left
      </span>
    </>
  );
}
