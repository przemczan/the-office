import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { countedTokens, type FireAlarmOnNow, type Now } from "@the-office/contracts";
import { Icon } from "@the-office/ui";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { notificationQueries, nowQueries } from "../api/notifications.ts";
import { officeUpdateQueries } from "../api/office-updates.ts";
import { useEventStreamStatus } from "../api/event-stream-provider.tsx";
import { roleQueries } from "../api/people.ts";
import { ActivityFigure } from "./activity/activity-figure.tsx";
import { tokensShort } from "./conversation/context-words.ts";
import { alarmFigureWords } from "./fire-alarm/fire-alarm-words.ts";
import { useFireAlarmReview } from "./fire-alarm/fire-alarm-review.tsx";
import {
  askForDesktopPermission,
  desktopPermission,
  type DesktopPermission,
} from "./notifications/desktop-channel.ts";
import { needsYouWords } from "./notifications/now-words.ts";
import { officeMessages } from "./notifications/office-messages.ts";
import { OfficeMessages } from "./notifications/office-messages-slot.tsx";
import { useNeedsYou } from "./notifications/use-needs-you.ts";
import { useNeedsYouPanel } from "./notifications/use-needs-you-panel.ts";
import { useWaitingForYou } from "./notifications/use-waiting-for-you.ts";
import { StripFigure, StripLabel } from "./strip-figure.tsx";
import { TokenInfo } from "./token-count.tsx";
import { UsageFigure } from "./usage-figure.tsx";
import { WorkstationFigure } from "./workstation/workstation-figure.tsx";

/**
 * The Office-wide figures under the top bar (spec §4, docs/design/status-strip.html), live from
 * `now.changed`, each a label over its value. On the left, never hidden: Needs you in the Projects
 * shown, which opens the Needs you panel, the engines' 5-hour windows, desks in use, Activity,
 * which opens its page, and tokens today, then the fire alarm while it is on, its desks at 0. On
 * the right the Workstation figure (polled on its own, so it shows while Now loads) and one slot
 * of a fixed width for what The Office tells the user. The strip lays itself out by its own width
 * (`@container strip`).
 */
export function StatusStrip(): ReactNode {
  const now = useQuery(nowQueries.now()).data;
  return (
    <div className="shell-strip" role="status" aria-label="Status strip">
      <div className="shell-strip-row">
        {now && <Figures now={now} />}
        {now?.fireAlarm && <AlarmFigure alarm={now.fireAlarm} />}
        <span className="shell-grow" />
        <WorkstationFigure />
        <OfficeMessagesSlot />
      </div>
    </div>
  );
}

function Figures({ now }: { readonly now: Now }): ReactNode {
  // While the alarm is on ASAP nothing runs at a desk, though its Tasks keep theirs; a softer way
  // lets the started Tasks go on at theirs.
  const inUse = now.fireAlarm?.way === "asap" ? 0 : now.desks.inUse;
  return (
    <div className="shell-strip-figures">
      <NeedsYouFigure />
      <span className="shell-strip-separator" />
      <UsageFigure now={now} />
      <span className="shell-strip-separator" />
      <StripFigure
        label={<StripLabel long="Desks in use" short="Desks" />}
        value={
          <>
            <span className={`shell-dot ${inUse > 0 ? "running" : "idle"}`} />
            <b>{inUse}</b>
            <span className="shell-strip-faint">/ {now.desks.limit}</span>
          </>
        }
        action={{ kind: "text", title: `${inUse} of ${now.desks.limit} desks in use` }}
      />
      <span className="shell-strip-separator" />
      <ActivityFigure />
      <StripFigure
        label={<StripLabel long="Tokens today" short="Tokens" />}
        value={
          <>
            <b>{tokensShort(countedTokens(now.tokensToday))}</b>
            <TokenInfo tokens={now.tokensToday} />
          </>
        }
        action={{ kind: "text" }}
      />
    </div>
  );
}

/**
 * The one figure the Project filter narrows, saying how many more wait in other Projects. It is an
 * alert while something waits in the Projects shown, a softer tint while only other Projects have
 * something, and quiet otherwise; it pops once each time the count goes up. Beside its number, a
 * small count of what is Waiting for you in the Projects shown, which never changes the tone, the
 * pop or the live dot.
 */
function NeedsYouFigure(): ReactNode {
  const needsYouPanel = useNeedsYouPanel();
  const needsYou = useNeedsYou();
  const waiting = useWaitingForYou()?.shown.length ?? 0;
  const pops = useRises(needsYou?.shown.length);
  if (!needsYou) return null;
  const count = needsYou.shown.length;
  const { elsewhere } = needsYou;
  const tone = count > 0 ? " alert" : elsewhere > 0 ? " elsewhere" : "";
  // Two classes with the same pop under different animation names, swapped on each rise, so the
  // browser replays it without remounting the button, which would take its focus away.
  const pop = pops === 0 ? "" : pops % 2 === 1 ? " pop" : " pop-again";
  const waitingName = `${waiting} waiting for you`;
  const name = [
    `${count} ${needsYouWords(count)}`,
    elsewhere > 0 && `${elsewhere} more in other Projects`,
    waiting > 0 && waitingName,
  ]
    .filter((part) => part !== false)
    .join(", ");
  return (
    <StripFigure
      className={`shell-strip-needs-you${tone}${pop}`}
      label={
        <>
          {count > 0 && <span className="live-dot" aria-hidden="true" />}
          Needs you
        </>
      }
      value={
        <>
          <b>{count}</b>
          {waiting > 0 && (
            <span className="shell-strip-faint shell-strip-waiting" title={waitingName}>
              <span className="shell-strip-roomy">· {waiting} waiting</span>
              <span className="shell-strip-tight">·{waiting}</span>
            </span>
          )}
          {elsewhere > 0 && (
            <span className="shell-strip-faint" title={`${elsewhere} more in other Projects`}>
              <span className="shell-strip-roomy">+{elsewhere} in other Projects</span>
              <span className="shell-strip-tight">+{elsewhere}</span>
            </span>
          )}
        </>
      }
      action={{ kind: "button", name, onClick: needsYouPanel.open }}
    />
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
 * While the alarm is on, after Tokens today: why Desks in use reads 0 under ASAP, or how a softer
 * way stops; it opens the all clear's review.
 */
function AlarmFigure({ alarm }: { readonly alarm: FireAlarmOnNow }): ReactNode {
  const review = useFireAlarmReview();
  const navigate = useNavigate();
  const words = alarmFigureWords(alarm);
  return (
    <StripFigure
      className="shell-strip-alarm"
      label={
        <>
          <Icon name="siren" size={11} />
          Fire alarm
        </>
      }
      value={
        <b>
          <span className="shell-strip-roomy">{words}</span>
          <span className="shell-strip-tight">On</span>
        </b>
      }
      action={{
        kind: "button",
        name: `Fire alarm: ${words}. See what will resume, then give the all clear`,
        onClick: () => {
          review.open();
          void navigate({ to: "/" });
        },
      }}
    />
  );
}

/**
 * Gathers what The Office tells the user into the slot: the web reconnecting, the Office's own
 * Notifications until they clear, an Office update or restart while one is scheduled, and the
 * desktop ask until the user answers, after which the browser keeps the answer.
 */
function OfficeMessagesSlot(): ReactNode {
  const reconnecting = useEventStreamStatus() === "reconnecting";
  const notifications = useQuery(notificationQueries.open()).data ?? [];
  const roles = useQuery(roleQueries.list()).data;
  const scheduled = useQuery(officeUpdateQueries.officeUpdate()).data?.scheduled;
  const [permission, setPermission] = useState<DesktopPermission>(desktopPermission);
  const messages = officeMessages({
    reconnecting,
    notifications,
    scheduled: scheduled && { kind: scheduled.kind, waitingFor: scheduled.busy.length },
    desktopAsk: permission === "default",
  });
  if (!messages) return null;
  return (
    <OfficeMessages
      messages={messages}
      roles={roles}
      onAskForDesktop={() => void askForDesktopPermission().then(setPermission)}
    />
  );
}
