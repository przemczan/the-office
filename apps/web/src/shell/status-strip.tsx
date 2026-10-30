import { useQuery } from "@tanstack/react-query";
import type { Now } from "@the-office/contracts";
import { useState, type ReactNode } from "react";
import { notificationQueries, nowQueries } from "../api/notifications.ts";
import { useEventStreamStatus } from "../api/event-stream-provider.tsx";
import { roleQueries } from "../api/people.ts";
import { alarmStateWords } from "./fire-alarm/fire-alarm-words.ts";
import "./fire-alarm/fire-alarm.css";
import {
  askForDesktopPermission,
  desktopPermission,
  type DesktopPermission as Permission,
} from "./notifications/desktop-channel.ts";
import { personOf } from "./notifications/notification-words.ts";
import { doneSinceYouLeft, needsYouWords, resetWords } from "./notifications/now-words.ts";
import { useNeedsYou } from "./notifications/use-needs-you.ts";
import { useNeedsYouPanel } from "./notifications/use-needs-you-panel.ts";
import { TokenCount } from "./token-count.tsx";

/**
 * The Office-wide figures under the top bar (spec §4), live from `now.changed`: what needs the
 * user in the Projects shown, which opens the Needs you panel, desks in use, tokens today, the 5-hour window, Tasks
 * touched and done since the user left, and the fire alarm's state, its desks at 0 while it is on.
 * While the web has lost the service it says so first,
 * and the Office's own Notifications (the window, the engine) show here until they clear, by the
 * Office Manager's name once one speaks them.
 */
export function StatusStrip(): ReactNode {
  const reconnecting = useEventStreamStatus() === "reconnecting";
  const now = useQuery(nowQueries.now()).data;
  const officeNotifications = (useQuery(notificationQueries.open()).data ?? []).filter(({ kind }) =>
    kind.startsWith("office."),
  );
  const roles = useQuery(roleQueries.list()).data;
  return (
    <div className="shell-strip" role="status" aria-label="Status strip">
      {reconnecting && (
        <span className="shell-strip-stat">
          <span className="shell-dot reconnecting" />
          Reconnecting to The Office…
        </span>
      )}
      {officeNotifications.map((notification) => {
        const person = personOf(notification, roles);
        return (
          <span key={notification.id} className="shell-strip-stat shell-strip-office">
            <span className="shell-dot reconnecting" />
            {person ? `${person}: ${notification.line}` : notification.line}
          </span>
        );
      })}
      {now && <Figures now={now} />}
      <span className="shell-grow" />
      <DesktopPermission />
      {now && (
        <span className={`shell-strip-alarm${now.fireAlarm ? " on" : ""}`}>
          <i aria-hidden="true" />
          {alarmStateWords(now.fireAlarm)}
        </span>
      )}
    </div>
  );
}

function Figures({ now }: { readonly now: Now }): ReactNode {
  const fiveHour = now.fiveHourWindow;
  const resets = fiveHour && resetWords(fiveHour.resetsAt);
  // While the alarm is on nothing runs at a desk, though its Tasks keep theirs.
  const inUse = now.fireAlarm ? 0 : now.desks.inUse;
  return (
    <>
      <NeedsYouFigure />
      <span className="shell-strip-stat">
        <span className={`shell-dot ${inUse > 0 ? "running" : "idle"}`} />
        <b>{inUse}</b>
        <span className="shell-strip-faint">/ {now.desks.limit}</span> desks in use
      </span>
      <span className="shell-strip-separator" />
      <span className="shell-strip-stat">
        <TokenCount tokens={now.tokensToday} label="tokens today" strong />
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

/** The one figure the Project filter narrows, saying how many more wait in other Projects. */
function NeedsYouFigure(): ReactNode {
  const needsYouPanel = useNeedsYouPanel();
  const needsYou = useNeedsYou();
  if (!needsYou) return null;
  const count = needsYou.shown.length;
  return (
    <button
      type="button"
      className="shell-strip-stat shell-strip-needs-you"
      aria-haspopup="dialog"
      onClick={needsYouPanel.open}
    >
      <b>{count}</b> {needsYouWords(count)}
      {needsYou.elsewhere > 0 && (
        <span className="shell-strip-faint">+{needsYou.elsewhere} in other Projects</span>
      )}
    </button>
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
