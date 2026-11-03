import type { Now } from "@the-office/contracts";
import { Fragment, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  percentWords,
  resetMomentWords,
  resetWords,
  usageFigureLabel,
  usageFigureWords,
  type NamedUsageWindows,
  type UsageWindow,
} from "./notifications/now-words.ts";
import { useUsageWindows } from "./notifications/use-usage-windows.ts";
import { useClosedFromOutside } from "./use-closed-from-outside.ts";
import { usePlacedList } from "./use-placed-list.ts";

/**
 * The strip's one figure for the engines' usage windows, small however many engines were read:
 * nothing until one is, one engine's in full, and several behind a list of each.
 */
export function UsageFigure({ now }: { readonly now: Pick<Now, "usageWindows"> }): ReactNode {
  const windows = useUsageWindows(now);
  const [first] = windows;
  if (!first) return null;
  return windows.length === 1 ? (
    <OneEngine windows={first} />
  ) : (
    <SeveralEngines windows={windows} />
  );
}

function OneEngine({ windows }: { readonly windows: NamedUsageWindows }): ReactNode {
  const { percentUsed, resetsAt } = windows.fiveHour;
  const resets = resetWords(resetsAt);
  return (
    <span className="shell-strip-stat wide">
      <FigureWords windows={[windows]} />
      <span className="shell-strip-meter" aria-hidden="true">
        <i style={{ width: `${Math.min(100, Math.max(0, percentUsed))}%` }} />
      </span>
      {resets && <span className="shell-strip-faint">{resets}</span>}
    </span>
  );
}

function SeveralEngines({
  windows,
}: {
  readonly windows: readonly NamedUsageWindows[];
}): ReactNode {
  const [open, setOpen] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const anchor = useClosedFromOutside(open, setOpen, list);
  usePlacedList(open, anchor, list, "start");
  return (
    <div ref={anchor} className="shell-strip-stat wide">
      <button
        type="button"
        className="shell-strip-usage"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={usageFigureLabel(windows)}
        onClick={() => setOpen(!open)}
      >
        <FigureWords windows={windows} />
      </button>
      {open &&
        // On the page's body, as the strip clips what leaves it.
        createPortal(
          <div
            ref={list}
            role="dialog"
            aria-label="Usage by engine"
            className="floating-menu shell-usage-list"
          >
            <ul>
              {windows.map((engine) => (
                <EngineUsage key={engine.engineId} windows={engine} />
              ))}
            </ul>
          </div>,
          document.body,
        )}
    </div>
  );
}

function FigureWords({ windows }: { readonly windows: readonly NamedUsageWindows[] }): ReactNode {
  return (
    <span>
      {usageFigureWords(windows).map(({ before, figure, after, engineName }, index) => (
        <Fragment key={index}>
          {index > 0 && " · "}
          {before && `${before} `}
          <b title={engineName}>{figure}</b>
          {after && ` ${after}`}
        </Fragment>
      ))}
    </span>
  );
}

function EngineUsage({ windows }: { readonly windows: NamedUsageWindows }): ReactNode {
  return (
    <li>
      <span className="shell-usage-engine">{windows.engineName}</span>
      <span>
        <WindowUse name="5h" window={windows.fiveHour} />
        {" · "}
        <WindowUse name="7d" window={windows.sevenDay} />
      </span>
    </li>
  );
}

function WindowUse({
  name,
  window,
}: {
  readonly name: string;
  readonly window: UsageWindow;
}): ReactNode {
  const resets = resetMomentWords(window.resetsAt);
  return (
    <>
      {name} <b>{percentWords(window)}</b>
      {resets && <span className="shell-strip-faint"> {resets}</span>}
    </>
  );
}
