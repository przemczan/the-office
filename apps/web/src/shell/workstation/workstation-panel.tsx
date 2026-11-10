import type { WorkstationLoad } from "@the-office/contracts";
import type { CSSProperties, ReactNode } from "react";
import type { WorkstationRead } from "./workstation-history.ts";
import { WorkstationSparkline } from "./workstation-sparkline.tsx";
import {
  bytesWords,
  coresWords,
  cpuUseWords,
  loadAverageWords,
  loadLevel,
  percentWords,
  shareOf,
  speedWords,
  uptimeWords,
} from "./workstation-words.ts";

/**
 * The Workstation panel: the CPU and memory now, each with its last 2 minutes, the use per core,
 * where the memory goes, the load average and the uptime. Each meter takes its level's colour,
 * with its number beside it as text.
 */
export function WorkstationPanel({
  load,
  history,
}: {
  readonly load: WorkstationLoad;
  readonly history: readonly WorkstationRead[];
}): ReactNode {
  const { cpu, memory } = load;
  const memoryPercent = shareOf(memory.usedBytes, memory.totalBytes);
  const cpuPercents = history.flatMap((read) =>
    read.cpuPercent === null ? [] : [read.cpuPercent],
  );
  return (
    <>
      <PanelHead load={load} />
      <div className="shell-workstation-tiles">
        <section
          aria-label="CPU"
          className="shell-workstation-tile"
          data-level={cpu.use ? loadLevel(cpu.use.percent) : undefined}
        >
          <h3 className="floating-menu-heading">CPU</h3>
          <b className="shell-workstation-figure">{cpuUseWords(cpu.use)}</b>
          <span className="shell-workstation-tile-line">{coresWords(cpu.cores)}</span>
          {cpu.use && <WorkstationSparkline percents={cpuPercents} />}
        </section>
        <section
          aria-label="Memory"
          className="shell-workstation-tile"
          data-level={loadLevel(memoryPercent)}
        >
          <h3 className="floating-menu-heading">Memory</h3>
          <b className="shell-workstation-figure">{percentWords(memoryPercent)}</b>
          <span className="shell-workstation-tile-line">
            <span>Used</span>
            <span>
              {bytesWords(memory.usedBytes)} / {bytesWords(memory.totalBytes)}
            </span>
          </span>
          <WorkstationSparkline percents={history.map((read) => read.memoryPercent)} />
        </section>
      </div>
      {cpu.use && <CoreBars perCore={cpu.use.perCore} />}
      <MemorySplit load={load} />
      <dl className="shell-workstation-foot">
        {cpu.loadAverage && (
          <div>
            <dt>Load average</dt>
            <dd>
              <b>{loadAverageWords(cpu.loadAverage)}</b>
              <span className="shell-strip-faint">1, 5, 15 min</span>
            </dd>
          </div>
        )}
        <div>
          <dt>Up for</dt>
          <dd>
            <b>{uptimeWords(load.uptimeSeconds)}</b>
          </dd>
        </div>
      </dl>
    </>
  );
}

function PanelHead({ load }: { readonly load: WorkstationLoad }): ReactNode {
  const { model, speedMhz } = load.cpu;
  const speed = speedWords(speedMhz);
  const modelWords = speed && model ? `${model} · ${speed}` : model;
  return (
    <header className="shell-workstation-head">
      {/* A long model name is cut short, and whole in its tooltip. */}
      <span className="shell-workstation-model" title={modelWords}>
        {modelWords}
      </span>
      <span className="shell-workstation-live">
        <span className="live-dot" aria-hidden="true" />
        Live · every 2 s
      </span>
    </header>
  );
}

const CORES_A_ROW = 32;

function CoreBars({ perCore }: { readonly perCore: readonly number[] }): ReactNode {
  const columns = { "--columns": Math.min(perCore.length, CORES_A_ROW) } as CSSProperties;
  return (
    <div className="shell-workstation-block">
      <h3 className="floating-menu-heading">Use per core</h3>
      <ol className="shell-workstation-cores" aria-label="Use per core" style={columns}>
        {perCore.map((percent, index) => {
          const words = `Core ${index + 1}: ${percentWords(percent)}`;
          return (
            <li key={index} title={words} data-level={loadLevel(percent)}>
              <i style={{ height: `${Math.min(100, Math.max(0, percent))}%` }} />
              <span className="visually-hidden">{words}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** One bar: The Office's share, the other used memory in the memory's level, and what's free. */
function MemorySplit({ load }: { readonly load: WorkstationLoad }): ReactNode {
  const { totalBytes, usedBytes, availableBytes } = load.memory;
  const officeBytes = Math.min(load.officeMemoryBytes, usedBytes);
  const otherBytes = usedBytes - officeBytes;
  return (
    <div
      className="shell-workstation-block shell-workstation-memory"
      data-level={loadLevel(shareOf(usedBytes, totalBytes))}
    >
      <span className="shell-workstation-split" aria-hidden="true">
        <i className="office" style={{ width: `${shareOf(officeBytes, totalBytes)}%` }} />
        <i className="other" style={{ width: `${shareOf(otherBytes, totalBytes)}%` }} />
      </span>
      <ul className="shell-workstation-legend" aria-label="Memory in use">
        <li className="office">
          The Office <b>{bytesWords(load.officeMemoryBytes)}</b>
        </li>
        <li className="other">
          Other used <b>{bytesWords(otherBytes)}</b>
        </li>
        <li className="available">
          Available <b>{bytesWords(availableBytes)}</b>
        </li>
      </ul>
    </div>
  );
}
