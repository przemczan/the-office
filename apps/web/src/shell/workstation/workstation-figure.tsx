import { useQuery } from "@tanstack/react-query";
import type { WorkstationLoad } from "@the-office/contracts";
import { Icon } from "@the-office/ui";
import { useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { workstationQueries } from "../../api/workstation.ts";
import { useClosedFromOutside } from "../use-closed-from-outside.ts";
import { usePlacedList } from "../use-placed-list.ts";
import {
  bytesWords,
  coresWords,
  cpuUseWords,
  loadAverageWords,
  MEASURING,
  percentWords,
  shareOf,
  speedWords,
  uptimeWords,
} from "./workstation-words.ts";

/**
 * The strip's Workstation figure: the CPU use now and the logical cores of the computer The Office
 * runs on, opening a panel with its CPU, memory and uptime. Both read again every 2 s while the
 * tab is visible; nothing shows until the first read or after a failed one.
 */
export function WorkstationFigure(): ReactNode {
  const { data: load, isError } = useQuery(workstationQueries.load());
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const anchor = useClosedFromOutside(open, setOpen, panel);
  usePlacedList(open, anchor, panel, "end");
  // A failed read leaves the last one in the cache; the strip says the service is gone instead.
  if (!load || isError) return null;
  const { use, cores } = load.cpu;
  return (
    <div ref={anchor} className="shell-strip-stat">
      <button
        type="button"
        className="shell-strip-usage shell-strip-workstation"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Workstation: ${use ? `${percentWords(use.percent)} CPU` : MEASURING}, ${coresWords(cores)}`}
        onClick={() => setOpen(!open)}
      >
        <Icon name="cpu" size={14} />
        {use ? (
          <b>{percentWords(use.percent)}</b>
        ) : (
          <span className="shell-strip-faint">{MEASURING}</span>
        )}
        {/* Left out on a narrow page, keeping the icon and the %. */}
        <span className="shell-strip-workstation-detail">
          {use && "CPU "}
          <span className="shell-strip-faint">· {coresWords(cores)}</span>
        </span>
      </button>
      {open &&
        // On the page's body, as the strip clips what leaves it.
        createPortal(
          <div
            ref={panel}
            role="dialog"
            aria-label="Workstation"
            className="floating-menu shell-workstation-panel"
          >
            <WorkstationDetails load={load} />
          </div>,
          document.body,
        )}
    </div>
  );
}

function WorkstationDetails({ load }: { readonly load: WorkstationLoad }): ReactNode {
  const { cpu, memory } = load;
  const speed = speedWords(cpu.speedMhz);
  return (
    <>
      <section aria-label="CPU">
        <h3 className="floating-menu-heading">CPU</h3>
        <dl>
          {cpu.model && <Row name="Model" value={speed ? `${cpu.model} · ${speed}` : cpu.model} />}
          <Row
            name="Use now"
            value={
              <>
                {cpu.use && <Meter percent={cpu.use.percent} />}
                <b>{cpuUseWords(cpu.use)}</b>
              </>
            }
          />
          <Row name="Logical cores" value={<b>{cpu.cores}</b>} />
          {cpu.loadAverage && (
            <Row
              name="Load average"
              value={loadAverageWords(cpu.loadAverage)}
              hint="1, 5, 15 min"
            />
          )}
        </dl>
        {cpu.use && (
          <ol className="shell-workstation-cores" aria-label="Use per core">
            {cpu.use.perCore.map((percent, index) => (
              <li key={index} title={`Core ${index + 1}: ${percentWords(percent)}`}>
                <Meter percent={percent} />
                <span>{percentWords(percent)}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
      <section aria-label="Memory">
        <h3 className="floating-menu-heading">Memory</h3>
        <dl>
          <Row
            name="Used"
            value={
              <>
                <Meter percent={shareOf(memory.usedBytes, memory.totalBytes)} />
                <b>
                  {bytesWords(memory.usedBytes)} / {bytesWords(memory.totalBytes)}
                </b>
                <span className="shell-strip-faint">
                  {percentWords(shareOf(memory.usedBytes, memory.totalBytes))}
                </span>
              </>
            }
          />
          <Row name="Available" value={bytesWords(memory.availableBytes)} />
        </dl>
      </section>
      <section aria-label="The Office">
        <h3 className="floating-menu-heading">The Office</h3>
        <dl>
          <Row name="Memory" value={bytesWords(load.officeMemoryBytes)} />
        </dl>
      </section>
      <section aria-label="Uptime">
        <h3 className="floating-menu-heading">Uptime</h3>
        <dl>
          <Row name="Up for" value={uptimeWords(load.uptimeSeconds)} />
        </dl>
      </section>
    </>
  );
}

function Row({
  name,
  value,
  hint,
}: {
  readonly name: string;
  readonly value: ReactNode;
  readonly hint?: string;
}): ReactNode {
  return (
    <div>
      <dt>{name}</dt>
      <dd>
        {value}
        {hint && <span className="shell-strip-faint">{hint}</span>}
      </dd>
    </div>
  );
}

function Meter({ percent }: { readonly percent: number }): ReactNode {
  return (
    <span className="shell-strip-meter" aria-hidden="true">
      <i style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
    </span>
  );
}
