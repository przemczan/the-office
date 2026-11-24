import { appendFile, mkdir, open } from "node:fs/promises";
import { dirname } from "node:path";
import { Injectable } from "@nestjs/common";
import { ActionProjects } from "../ports/action-projects.js";

/** The most of a log one read answers; the reader reads on from the offset it gets. */
const MOST_BYTES_PER_READ = 256 * 1024;

/** Hides Secret variables' values in a line The Office writes itself. */
export interface LineMask {
  mask(text: string): string;
}

const NO_LINE_MASK: LineMask = { mask: (text) => text };

/**
 * Each Project command run's and Workflow run's log, `<office-data>/action-runs/<run id>.log`
 * (spec §2.15, "Log"): The Office's own lines, `[The Office] …`, masked, and what the commands
 * print, which their runner appends masked. Kept with the run; removed with it.
 */
@Injectable()
export class ActionRunLogs {
  constructor(private readonly projects: ActionProjects) {}

  /** Appends one line of The Office's own, masked. */
  async note(runId: string, line: string, mask: LineMask = NO_LINE_MASK): Promise<void> {
    const file = this.projects.logFileOf(runId);
    await mkdir(dirname(file), { recursive: true });
    await appendFile(file, `[The Office] ${mask.mask(line)}\n`);
  }

  /**
   * The log from byte `from` on, at most so much at once and never cutting a character in two, and
   * the offset to read on from; nothing yet when there is no log.
   */
  async read(runId: string, from: number): Promise<{ text: string; nextOffset: number }> {
    const file = await open(this.projects.logFileOf(runId), "r").catch(() => undefined);
    if (file === undefined) return { text: "", nextOffset: from };
    try {
      const buffer = Buffer.alloc(MOST_BYTES_PER_READ);
      const { bytesRead } = await file.read(buffer, 0, MOST_BYTES_PER_READ, from);
      const whole = wholeCharacters(buffer.subarray(0, bytesRead));
      return { text: whole.toString("utf8"), nextOffset: from + whole.length };
    } finally {
      await file.close();
    }
  }

  remove(runId: string): Promise<void> {
    return this.projects.removeLog(runId);
  }
}

/** The bytes up to the last whole UTF-8 character. */
function wholeCharacters(bytes: Buffer): Buffer {
  // A character is at most 4 bytes: look back at most 3 for a lead byte whose sequence is cut.
  for (let back = 1; back <= Math.min(3, bytes.length); back++) {
    const byte = bytes[bytes.length - back] ?? 0;
    if ((byte & 0xc0) === 0x80) continue;
    const length = byte >= 0xf0 ? 4 : byte >= 0xe0 ? 3 : byte >= 0xc0 ? 2 : 1;
    return length > back ? bytes.subarray(0, bytes.length - back) : bytes;
  }
  return bytes;
}
