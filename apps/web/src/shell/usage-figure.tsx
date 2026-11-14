import type { Now } from "@the-office/contracts";
import { useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  meterFilled,
  percentWords,
  resetMomentWords,
  usageFigureLabel,
  usageFigureWords,
  usageTone,
  type NamedUsageWindows,
  type UsageReading,
  type UsageWindow,
} from "./notifications/now-words.ts";
import { useUsageWindows } from "./notifications/use-usage-windows.ts";
import { StripFigure, StripLabel } from "./strip-figure.tsx";
import { useClosedFromOutside } from "./use-closed-from-outside.ts";
import { usePlacedList } from "./use-placed-list.ts";

/**
 * The strip's one figure for the engines' 5-hour windows, small however many engines were read:
 * nothing until one is, one engine's with its meter, a few each with its own, and past that the
 * highest. Each % and meter turns amber when nearly used and red when used up. A press opens Usage
 * by engine, each engine's windows with their resets.
 */
export function UsageFigure({ now }: { readonly now: Pick<Now, "usageWindows"> }): ReactNode {
  const windows = useUsageWindows(now);
  const [open, setOpen] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const anchor = useClosedFromOutside(open, setOpen, list);
  usePlacedList(open, anchor, list, "start");
  const figure = usageFigureWords(windows);
  if (!figure) return null;
  return (
    <div ref={anchor} className="shell-strip-anchor">
      <StripFigure
        className="shell-strip-usage"
        label={
          <>
            <StripLabel long="5-hour window" short="5h window" />
            {figure.detail && <span className="shell-strip-roomy">· {figure.detail}</span>}
          </>
        }
        value={
          <>
            {figure.shows === "each" ? (
              <span className="shell-strip-engines">
                {figure.readings.map((reading) => (
                  <span key={reading.engineName}>
                    <UsageMeter reading={reading} />
                    <Percent reading={reading} />
                  </span>
                ))}
              </span>
            ) : (
              figure.readings.map((reading) => (
                <span key={reading.engineName} className="shell-strip-engines">
                  <Percent reading={reading} />
                  <UsageMeter reading={reading} />
                </span>
              ))
            )}
            {figure.after && (
              <span
                className={`shell-strip-faint${figure.shows === "one" ? " shell-strip-roomy" : ""}`}
              >
                {figure.after}
              </span>
            )}
          </>
        }
        action={{
          kind: "button",
          name: usageFigureLabel(windows),
          expanded: open,
          onClick: () => setOpen(!open),
        }}
      />
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

function Percent({ reading }: { readonly reading: UsageReading }): ReactNode {
  return (
    <b data-tone={reading.tone} title={reading.engineName}>
      {reading.percent}
    </b>
  );
}

function UsageMeter({
  reading,
}: {
  readonly reading: Pick<UsageReading, "filled" | "tone">;
}): ReactNode {
  return (
    <span className="shell-strip-meter" data-tone={reading.tone} aria-hidden="true">
      <i style={{ width: `${reading.filled}%` }} />
    </span>
  );
}

function EngineUsage({ windows }: { readonly windows: NamedUsageWindows }): ReactNode {
  return (
    <li>
      <span className="shell-usage-engine">{windows.engineName}</span>
      <WindowUse name="5h" window={windows.fiveHour} />
      <WindowUse name="7d" window={windows.sevenDay} />
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
  const tone = usageTone(window);
  return (
    <span className="shell-usage-window">
      <span>{name}</span>
      <UsageMeter reading={{ filled: meterFilled(window), tone }} />
      <b data-tone={tone}>{percentWords(window)}</b>
      {resets && <span className="shell-strip-faint">{resets}</span>}
    </span>
  );
}
