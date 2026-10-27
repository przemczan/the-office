import { useQuery } from "@tanstack/react-query";
import type { Now } from "@the-office/contracts";
import { useState, type ReactNode } from "react";
import { notificationQueries, nowQueries } from "../api/notifications.ts";
import { useEventStreamStatus } from "../api/event-stream-provider.tsx";
import { tokensShort } from "./conversation/context-words.ts";
import {
  askForDesktopPermission,
  desktopPermission,
  type DesktopPermission as Permission,
} from "./notifications/desktop-channel.ts";
import { doneSinceYouLeft, needsYouWords, resetWords } from "./notifications/now-words.ts";
import { useNeedsYouPanel } from "./notifications/use-needs-you-panel.ts";

/**
 * The Office-wide figures under the top bar (spec §4), live from `now.changed`: what needs the
 * user, which opens the Needs you panel, desks in use, tokens today, the 5-hour window, Tasks
 * touched and done since the user left. While the web has lost the service it says so first,
 * and the Office's own Notifications (the window, the engine) show here until they clear.
 */
export function StatusStrip(): ReactNode {
  const reconnecting = useEventStreamStatus() === "reconnecting";
  const now = useQuery(nowQueries.now()).data;
  const officeNotifications = (useQuery(notificationQueries.open()).data ?? []).filter(({ kind }) =>
    kind.startsWith("office."),
  );
  return (
    <div className="shell-strip" role="status" aria-label="Status strip">
      {reconnecting && (
        <span className="shell-strip-stat">
          <span className="shell-dot reconnecting" />
          Reconnecting to The Office…
        </span>
      )}
      {officeNotifications.map(({ id, line }) => (
        <span key={id} className="shell-strip-stat shell-strip-office">
          <span className="shell-dot reconnecting" />
          {line}
        </span>
      ))}
      {now && <Figures now={now} />}
      <span className="shell-grow" />
      <DesktopPermission />
    </div>
  );
}

function Figures({ now }: { readonly now: Now }): ReactNode {
  const needsYouPanel = useNeedsYouPanel();
  const fiveHour = now.fiveHourWindow;
  const resets = fiveHour && resetWords(fiveHour.resetsAt);
  return (
    <>
      <button
        type="button"
        className="shell-strip-stat shell-strip-needs-you"
        aria-haspopup="dialog"
        onClick={needsYouPanel.open}
      >
        <b>{now.needsYou.length}</b> {needsYouWords(now.needsYou.length)}
      </button>
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

/**
 * Desktop Notifications need the browser's permission, asked once: offered here until the user
 * answers, after which the browser keeps the answer.
 */
function DesktopPermission(): ReactNode {
  const [permission, setPermission] = useState<Permission>(desktopPermission);
  if (permission !== "default") return null;
  return (
    <button
      type="button"
      className="shell-strip-stat shell-strip-action"
      onClick={() => void askForDesktopPermission().then(setPermission)}
    >
      Turn on desktop notifications
    </button>
  );
}
