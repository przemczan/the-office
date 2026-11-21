import { Injectable } from "@nestjs/common";
import { appendFile, mkdir, open, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { OfficeDataDirectory } from "../../../platform/office-data/office-data-directory.js";

/** The most of a log one read answers; the reader reads on from the offset it gets. */
const MOST_BYTES_PER_READ = 256 * 1024;

/** Hides Secret variables' values in a line the module writes itself. */
export interface LineMask {
  mask(text: string): string;
}

const NO_LINE_MASK: LineMask = { mask: (text) => text };

/**
 * Each instance's files in `<office-data>/test-instances/`: its checkout, `<id>/`, removed when it
 * ends (spec §5.5, "A test instance's checkout"), and its log, `<id>.log` beside it, kept with the
 * instance (spec §2.12, "Log"); and a Built instance's files in `<office-data>/test-builds/<id>/`.
 */
@Injectable()
export class InstanceFiles {
  constructor(private readonly officeData: OfficeDataDirectory) {}

  get folder(): string {
    return this.officeData.folder("test-instances");
  }

  checkoutOf(id: string): string {
    return this.officeData.testInstanceFolder(id);
  }

  logOf(id: string): string {
    return join(this.folder, `${id}.log`);
  }

  /** Where a Built instance's files are kept: `<office-data>/test-builds/<id>/`. */
  buildFilesOf(id: string): string {
    return join(this.officeData.folder("test-builds"), id);
  }

  /** Removes a Built instance's files; none there is no failure. */
  async removeBuildFiles(id: string): Promise<void> {
    await rm(this.buildFilesOf(id), { recursive: true, force: true, maxRetries: 5 });
  }

  /** Appends one line of The Office's own to the instance's log, masked. */
  async note(id: string, line: string, mask: LineMask = NO_LINE_MASK): Promise<void> {
    await mkdir(this.folder, { recursive: true });
    await appendFile(this.logOf(id), `[The Office] ${mask.mask(line)}\n`);
  }

  /**
   * The log from byte `from` on, at most so much at once and never cutting a character in two, and
   * the offset to read on from; nothing yet when there is no log.
   */
  async read(id: string, from: number): Promise<{ text: string; nextOffset: number }> {
    const file = await open(this.logOf(id), "r").catch(() => undefined);
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

  /** The checkouts left in the folder, by their folders; the logs stay. */
  async leftCheckouts(): Promise<string[]> {
    const entries = await readdir(this.folder, { withFileTypes: true }).catch(() => []);
    return entries
      .filter((entry) => entry.isDirectory())
      .map(({ name }) => join(this.folder, name));
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
