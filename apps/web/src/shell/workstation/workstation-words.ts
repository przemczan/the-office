import type { CpuUse, LoadAverage } from "@the-office/contracts";

/** Said where a CPU use would be until the service has measured one. */
export const MEASURING = "Measuring…";

const GB = 1024 ** 3;
const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** A use in whole percent, as "23%". */
export function percentWords(percent: number): string {
  return `${Math.round(percent)}%`;
}

/** The CPU use now, or "Measuring…" before the first measure. */
export function cpuUseWords(use: CpuUse | null): string {
  return use ? percentWords(use.percent) : MEASURING;
}

/** "1 core" or "16 cores". */
export function coresWords(cores: number): string {
  return cores === 1 ? "1 core" : `${cores} cores`;
}

/** Bytes as gigabytes to one decimal place, as "12.4 GB". */
export function bytesWords(bytes: number): string {
  return `${(bytes / GB).toFixed(1)} GB`;
}

/** A clock speed, as "3.2 GHz", or nothing where the system doesn't report one. */
export function speedWords(speedMhz: number): string | undefined {
  return speedMhz > 0 ? `${(speedMhz / 1000).toFixed(1)} GHz` : undefined;
}

/** The load average over 1, 5 and 15 minutes, as "1.52 · 1.20 · 0.98". */
export function loadAverageWords(load: LoadAverage): string {
  return [load.oneMinute, load.fiveMinutes, load.fifteenMinutes]
    .map((value) => value.toFixed(2))
    .join(" · ");
}

/** How long the workstation has been up, in its two largest units, as "3d 4h" or "12m". */
export function uptimeWords(uptimeSeconds: number): string {
  const days = Math.floor(uptimeSeconds / DAY);
  const hours = Math.floor((uptimeSeconds % DAY) / HOUR);
  const minutes = Math.floor((uptimeSeconds % HOUR) / MINUTE);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/** Of a total in %, for a meter: 0 when the total is unknown. */
export function shareOf(part: number, total: number): number {
  return total > 0 ? Math.min(100, Math.max(0, (part / total) * 100)) : 0;
}
