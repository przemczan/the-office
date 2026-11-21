import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Injectable } from "@nestjs/common";
import { OfficeDataDirectory } from "../../../platform/office-data/office-data-directory.js";
import { Schedule } from "../../../platform/schedule/schedule.js";
import { TEST_BUILD_LINK_MS } from "../domain/test-build.js";

/** The key's file, beside the builds' folders, readable by The Office's user alone. */
const KEY_FILE = ".link-key";
const KEY_BYTES = 32;

/** One file of one instance a link is for. */
export interface LinkedFile {
  readonly instanceId: string;
  readonly name: string;
}

/**
 * The QR code's links (spec §2.12, "Build to install"): a token naming one file of one instance and
 * when it expires, signed with HMAC-SHA256 under a key The Office makes once and keeps in
 * `<office-data>/test-builds/.link-key`, so a link outlives a restart until it expires. Nothing is
 * stored per link.
 */
@Injectable()
export class TestBuildLinks {
  private key: Promise<Buffer> | undefined;

  constructor(
    private readonly officeData: OfficeDataDirectory,
    private readonly schedule: Schedule,
  ) {}

  /** A token for the file, valid for `TEST_BUILD_LINK_MS` from now, and when it expires. */
  async issue(file: LinkedFile): Promise<{ token: string; expiresAt: Date }> {
    const expiresAt = new Date(this.schedule.now().getTime() + TEST_BUILD_LINK_MS);
    const payload = Buffer.from(
      [file.instanceId, String(expiresAt.getTime()), file.name].join("\n"),
      "utf8",
    );
    const mac = createHmac("sha256", await this.keyOf())
      .update(payload)
      .digest();
    return {
      token: `${payload.toString("base64url")}.${mac.toString("base64url")}`,
      expiresAt,
    };
  }

  /** The file a token is for, while it hasn't expired and its signature holds; else undefined. */
  async check(token: string): Promise<LinkedFile | undefined> {
    const parts = token.split(".");
    if (parts.length !== 2) return undefined;
    const [encodedPayload = "", encodedMac = ""] = parts;
    const payload = Buffer.from(encodedPayload, "base64url");
    const mac = Buffer.from(encodedMac, "base64url");
    const expected = createHmac("sha256", await this.keyOf())
      .update(payload)
      .digest();
    if (mac.length !== expected.length || !timingSafeEqual(mac, expected)) return undefined;
    const [instanceId, expiry, ...name] = payload.toString("utf8").split("\n");
    const expiresAtMs = Number(expiry);
    if (instanceId === undefined || !Number.isSafeInteger(expiresAtMs) || name.length === 0) {
      return undefined;
    }
    if (this.schedule.now().getTime() >= expiresAtMs) return undefined;
    return { instanceId, name: name.join("\n") };
  }

  private keyOf(): Promise<Buffer> {
    this.key ??= this.readOrMakeKey().catch((error: unknown) => {
      this.key = undefined;
      throw error;
    });
    return this.key;
  }

  private async readOrMakeKey(): Promise<Buffer> {
    const folder = this.officeData.folder("test-builds");
    const file = join(folder, KEY_FILE);
    const kept = await readFile(file).catch(() => undefined);
    if (kept?.length === KEY_BYTES) return kept;
    await mkdir(folder, { recursive: true });
    const key = randomBytes(KEY_BYTES);
    try {
      await writeFile(file, key, { mode: 0o600, flag: kept === undefined ? "wx" : "w" });
      return key;
    } catch (error) {
      // Made meanwhile by another start: that one is the key.
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      return readFile(file);
    }
  }
}
