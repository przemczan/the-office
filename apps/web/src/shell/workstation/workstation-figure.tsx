import { useQuery } from "@tanstack/react-query";
import { Icon } from "@the-office/ui";
import { useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { workstationQueries } from "../../api/workstation.ts";
import { StripFigure } from "../strip-figure.tsx";
import { useClosedFromOutside } from "../use-closed-from-outside.ts";
import { usePlacedList } from "../use-placed-list.ts";
import { useWorkstationHistory } from "./workstation-history.ts";
import { WorkstationPanel } from "./workstation-panel.tsx";
import { coresWords, loadLevel, MEASURING, percentWords } from "./workstation-words.ts";
import "./workstation.css";

/**
 * The strip's Workstation figure: the CPU use now and the logical cores of the computer The Office
 * runs on, opening a panel with its CPU, memory and uptime. Both read again every 2 s while the
 * tab is visible; nothing shows until the first read or after a failed one. Always in the strip,
 * it keeps the reads' history, so the panel's charts are filled when it opens.
 */
export function WorkstationFigure(): ReactNode {
  const { data: load, dataUpdatedAt, isError } = useQuery(workstationQueries.load());
  const history = useWorkstationHistory(load, dataUpdatedAt);
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const anchor = useClosedFromOutside(open, setOpen, panel);
  usePlacedList(open, anchor, panel, "end");
  // A failed read leaves the last one in the cache; the strip says the service is gone instead.
  if (!load || isError) return null;
  const { use, cores } = load.cpu;
  const level = use ? loadLevel(use.percent) : "calm";
  return (
    <div ref={anchor} className="shell-strip-anchor">
      <StripFigure
        className="shell-strip-workstation"
        label={
          <>
            <span className="shell-strip-roomy">Workstation</span>
            <span className="shell-strip-tight">CPU</span>
          </>
        }
        value={
          <>
            <Icon name="cpu" size={13} />
            {use ? (
              // Tinted only when busy or high, so the strip stays quiet while all is well.
              <b data-level={level === "calm" ? undefined : level}>{percentWords(use.percent)}</b>
            ) : (
              <span className="shell-strip-faint">{MEASURING}</span>
            )}
            {/* Left to the panel on a strip under 1,180px. */}
            <span className="shell-strip-faint shell-strip-cores">· {coresWords(cores)}</span>
          </>
        }
        action={{
          kind: "button",
          name: `Workstation: ${use ? `${percentWords(use.percent)} CPU` : MEASURING}, ${coresWords(cores)}`,
          expanded: open,
          onClick: () => setOpen(!open),
        }}
      />
      {open &&
        // On the page's body, as the strip clips what leaves it.
        createPortal(
          <div
            ref={panel}
            role="dialog"
            aria-label="Workstation"
            className="floating-menu shell-workstation-panel"
          >
            <WorkstationPanel load={load} history={history} />
          </div>,
          document.body,
        )}
    </div>
  );
}
