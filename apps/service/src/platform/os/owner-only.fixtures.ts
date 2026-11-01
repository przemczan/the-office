import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { promisify } from "node:util";

/**
 * Whether only the user the tests run as may read the file or folder: no group or other bits on
 * Linux; on Windows an access list of the user's own entries, none of them inherited.
 */
export async function isOwnerOnly(path: string): Promise<boolean> {
  if (process.platform !== "win32") return ((await stat(path)).mode & 0o077) === 0;
  const { stdout } = await promisify(execFile)("icacls", [path], { windowsHide: true });
  const user = `${process.env["USERDOMAIN"] ?? ""}\\${process.env["USERNAME"] ?? ""}`;
  // Each entry is "<principal>:<flags>", the first on the line that starts with the path.
  const entries = stdout
    .replace(path, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.includes(":("));
  return (
    entries.length > 0 &&
    entries.every(
      (entry) => entry.toUpperCase().startsWith(`${user.toUpperCase()}:`) && !entry.includes("(I)"),
    )
  );
}
