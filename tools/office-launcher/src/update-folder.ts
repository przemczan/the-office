// The folder the launcher (or the Office updater) shares with the service: the request the service
// writes before an update, and the result and log left for its next run (docs/running-the-office.md).
// The service's office-updates module reads and writes the same files by convention.
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const REQUEST_FILE = "request.json";
export const RESULT_FILE = "result.json";
export const LOG_FILE = "log.txt";
/** Where a release update downloads its tarball and checksum, emptied once it is over. */
export const DOWNLOADS_FOLDER = "downloads";

/** The steps of an update, of each kind, as `result.json` names the one that failed. */
export type UpdateStep =
  "fetch" | "merge" | "install" | "build" | "download" | "verify" | "unpack" | "switch" | "start";

/** What `result.json` holds once an update is over; the service reads it as it starts. */
export type UpdateResult =
  | {
      readonly outcome: "updated";
      readonly from: string;
      readonly to: string;
      readonly finishedAt: string;
    }
  | {
      readonly outcome: "failed";
      readonly from: string;
      readonly to: string;
      readonly failedStep: UpdateStep;
      /** Set when going back to `from` failed too, so the install may be neither. */
      readonly rollbackFailed?: true;
      readonly finishedAt: string;
    };

/** An update to a commit of a checkout's upstream. */
export interface CommitRequest {
  readonly kind: "commit";
  readonly target: string;
}

/** An update of a direct install to a released version, from its tarball. */
export interface ReleaseRequest {
  readonly kind: "release";
  readonly version: string;
  readonly from: string;
  readonly tarballUrl: string;
  readonly checksumUrl: string;
}

/** An update of a Docker Compose install to a released version's image, `<image>:<version>`. */
export interface ContainerRequest {
  readonly kind: "container";
  readonly version: string;
  readonly from: string;
  /** The image's repository without a tag, such as `ghcr.io/owner/the-office`. */
  readonly image: string;
}

export type UpdateRequest = CommitRequest | ReleaseRequest | ContainerRequest;

const COMMIT = /^[0-9a-f]{40}$/;
const VERSION = /^\d+\.\d+\.\d+$/;
const IMAGE = /^[a-z0-9][a-z0-9._/:-]*$/;

/**
 * The request the service wrote, which is taken, so a crash mid-update never repeats it; undefined
 * when there is none. Throws when it isn't a request the launcher carries out.
 */
export function takeRequest(updateFolder: string): UpdateRequest | undefined {
  mkdirSync(updateFolder, { recursive: true });
  const requestPath = join(updateFolder, REQUEST_FILE);
  let text: string;
  try {
    text = readFileSync(requestPath, "utf8");
  } catch {
    return undefined;
  }
  rmSync(requestPath, { force: true });
  return parseRequest(JSON.parse(text) as unknown, requestPath);
}

/** A request as `request.json` holds it; one without `kind` asks for a commit, as before releases. */
export function parseRequest(value: unknown, source = REQUEST_FILE): UpdateRequest {
  const fields = (typeof value === "object" && value !== null ? value : {}) as Record<
    string,
    unknown
  >;
  const kind = fields["kind"] ?? "commit";
  const invalid = (what: string) => new Error(`${source} ${what}.`);
  if (kind === "commit") {
    const target = fields["target"];
    if (typeof target !== "string" || !COMMIT.test(target)) throw invalid("names no commit");
    return { kind, target };
  }
  const version = fields["version"];
  const from = fields["from"];
  if (typeof version !== "string" || !VERSION.test(version))
    throw invalid("names no version to update to");
  if (typeof from !== "string" || !VERSION.test(from))
    throw invalid("names no version to update from");
  if (kind === "release") {
    const tarballUrl = httpsUrl(fields["tarballUrl"]);
    const checksumUrl = httpsUrl(fields["checksumUrl"]);
    if (!tarballUrl || !checksumUrl) throw invalid("gives no https:// tarball and checksum");
    return { kind, version, from, tarballUrl, checksumUrl };
  }
  if (kind === "container") {
    const image = fields["image"];
    if (typeof image !== "string" || !IMAGE.test(image)) throw invalid("names no image");
    return { kind, version, from, image };
  }
  throw invalid(`asks for an update of an unknown kind, ${String(kind)}`);
}

function httpsUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return URL.parse(value)?.protocol === "https:" ? value : undefined;
}

export function writeResult(updateFolder: string, result: UpdateResult): void {
  writeFileSync(join(updateFolder, RESULT_FILE), `${JSON.stringify(result, null, 2)}\n`);
}

/** `log.txt`, started afresh for an update; every step writes its lines there. */
export class UpdateLog {
  private readonly descriptor: number;

  constructor(updateFolder: string) {
    this.descriptor = openSync(join(updateFolder, LOG_FILE), "w");
  }

  /** The file descriptor, for a child process's output. */
  get fd(): number {
    return this.descriptor;
  }

  write(line: string): void {
    writeFileSync(this.descriptor, `${line}\n`);
  }

  step(step: string, what: string): void {
    this.write(`\n== ${step}: ${what}`);
  }

  close(): void {
    closeSync(this.descriptor);
  }
}

export function failure(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
