import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { Now, SinceYouLeft } from "@the-office/contracts";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { notificationQueries, nowQueries } from "../api/notifications.ts";
import { officeUpdateQueries } from "../api/office-updates.ts";
import { useEventStreamStatus } from "../api/event-stream-provider.tsx";
import { roleQueries } from "../api/people.ts";
import { alarmStateWords } from "./fire-alarm/fire-alarm-words.ts";
import "./fire-alarm/fire-alarm.css";
import {
  askForDesktopPermission,
  desktopPermission,
  type DesktopPermission as Permission,
} from "./notifications/desktop-channel.ts";
import { doneSinceYouLeft, needsYouWords } from "./notifications/now-words.ts";
import { OfficeNotificationsFigure } from "./notifications/office-notifications-figure.tsx";
import { useNeedsYou } from "./notifications/use-needs-you.ts";
import { useNeedsYouPanel } from "./notifications/use-needs-you-panel.ts";
import { TokenCount } from "./token-count.tsx";
import { UsageFigure } from "./usage-figure.tsx";
import { WorkstationFigure } from "./workstation/workstation-figure.tsx";

/**
 * The Office-wide figures under the top bar (spec §4), live from `now.changed`: what needs the
 * user in the Projects shown, which opens the Needs you panel, desks in use, tokens today, the usage figure, Tasks
 * touched and done since the user left, then on the right the Workstation figure (polled on its
 * own, so it shows while Now loads), an Office update while one is scheduled, and the fire
 * alarm's state, its desks at 0 while it is on.
 * While the web has lost the service it says so first,
 * and the Office's own Notifications (the window, the engine) show here until they clear: the newest
 * one, with the others in a list from "+N more".
 */
export function StatusStrip(): ReactNode {
  const reconnecting = useEventStreamStatus() === "reconnecting";
  const now = useQuery(nowQueries.now()).data;
  const officeNotifications = (useQuery(notificationQueries.open()).data ?? []).filter(({ kind }) =>
    kind.startsWith("office."),
  );
  const roles = useQuery(roleQueries.list()).data;
  const sinceYouLeft = useQuery(nowQueries.sinceYouLeft()).data;
  return (
    <div className="shell-strip" role="status" aria-label="Status strip">
      {reconnecting && (
        <span className="shell-strip-stat">
          <span className="shell-dot reconnecting" />
          Reconnecting to The Office…
        </span>
      )}
      <OfficeNotificationsFigure notifications={officeNotifications} roles={roles} />
      {now && <Figures now={now} sinceYouLeft={sinceYouLeft} />}
      <span className="shell-grow" />
      <WorkstationFigure />
      <ScheduledUpdate />
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

/** "Update scheduled" while an Office update waits, opening Settings › Updates. */
function ScheduledUpdate(): ReactNode {
  const scheduled = useQuery(officeUpdateQueries.officeUpdate()).data?.scheduled;
  if (!scheduled) return null;
  const waiting = scheduled.busy.length;
  return (
    <Link to="/settings/updates" className="shell-strip-stat shell-strip-update">
      <span className="shell-dot running" />
      Update scheduled
      {waiting > 0 && `, waiting for ${waiting === 1 ? "1 thing" : `${waiting} things`}`}
    </Link>
  );
}

function Figures({
  now,
  sinceYouLeft,
}: {
  readonly now: Now;
  readonly sinceYouLeft: SinceYouLeft | undefined;
}): ReactNode {
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
      <UsageFigure now={now} />
      <span className="shell-strip-stat wide">
        <b>{now.tasksTouched}</b> Tasks touched
      </span>
      <span className="shell-strip-separator" />
      <span className="shell-strip-stat wide">
        <b>{sinceYouLeft ? doneSinceYouLeft(sinceYouLeft) : 0}</b> done since you left
      </span>
    </>
  );
}

/**
 * The one figure the Project filter narrows, saying how many more wait in other Projects. It is an
 * alert while something waits in the Projects shown, a softer tint while only other Projects have
 * something, and quiet otherwise; it pops once each time the count goes up.
 */
function NeedsYouFigure(): ReactNode {
  const needsYouPanel = useNeedsYouPanel();
  const needsYou = useNeedsYou();
  const pops = useRises(needsYou?.shown.length);
  if (!needsYou) return null;
  const count = needsYou.shown.length;
  const tone = count > 0 ? " alert" : needsYou.elsewhere > 0 ? " elsewhere" : "";
  // Two classes with the same pop under different animation names, swapped on each rise, so the
  // browser replays it without remounting the button, which would take its focus away.
  const pop = pops === 0 ? "" : pops % 2 === 1 ? " pop" : " pop-again";
  return (
    <button
      type="button"
      className={`shell-strip-stat shell-strip-needs-you${tone}${pop}`}
      aria-haspopup="dialog"
      onClick={needsYouPanel.open}
    >
      {count > 0 && <span className="live-dot" aria-hidden="true" />}
      <b>{count}</b> {needsYouWords(count)}
      {needsYou.elsewhere > 0 && (
        <span className="shell-strip-faint">+{needsYou.elsewhere} in other Projects</span>
      )}
    </button>
  );
}

/** How many times `value` has gone up since it was first known, so the first load is no rise. */
function useRises(value: number | undefined): number {
  const previous = useRef(value);
  const [rises, setRises] = useState(0);
  useEffect(() => {
    if (value === undefined) return;
    if (previous.current !== undefined && value > previous.current) setRises((count) => count + 1);
    previous.current = value;
  }, [value]);
  return rises;
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
