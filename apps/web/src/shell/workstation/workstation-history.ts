import type { WorkstationLoad } from "@the-office/contracts";
import { useState } from "react";
import { shareOf } from "./workstation-words.ts";

/** The reads kept: about 2 minutes at one read every 2 s. */
export const HISTORY_LENGTH = 60;

/** One read as the panel's sparklines draw it; no CPU use before the service has measured one. */
export interface WorkstationRead {
  readonly cpuPercent: number | null;
  readonly memoryPercent: number;
}

/** The history with a new read, the oldest dropped once it holds `HISTORY_LENGTH`. */
export function withRead(
  history: readonly WorkstationRead[],
  read: WorkstationRead,
): readonly WorkstationRead[] {
  return [...history, read].slice(-HISTORY_LENGTH);
}

/** What a load gives the history. */
export function readOf(load: WorkstationLoad): WorkstationRead {
  return {
    cpuPercent: load.cpu.use?.percent ?? null,
    memoryPercent: shareOf(load.memory.usedBytes, load.memory.totalBytes),
  };
}

interface History {
  readonly updatedAt: number;
  readonly reads: readonly WorkstationRead[];
}

/**
 * The last reads, oldest first, kept in this browser only: empty after a reload, and not growing
 * while the tab is hidden, as the query doesn't read then. `updatedAt` tells a new read from the
 * same one rendered again.
 */
export function useWorkstationHistory(
  load: WorkstationLoad | undefined,
  updatedAt: number,
): readonly WorkstationRead[] {
  const [history, setHistory] = useState<History>({ updatedAt: 0, reads: [] });
  // Taken in during render, as React advises for state that follows a prop.
  if (load && updatedAt !== history.updatedAt) {
    setHistory({ updatedAt, reads: withRead(history.reads, readOf(load)) });
  }
  return history.reads;
}
