// No ssh server runs in the end-to-end tests, so the service's host key scanner is swapped for one
// that finds this key on every host (apps/service/src/e2e.ts, as the engine is scripted).
import { createHash } from "node:crypto";

/** The key every scanned host presents, as `ssh-keyscan` prints it. */
export const E2E_HOST_KEY =
  "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIC2qlhvoonlAi7vKu+ZR32+ZE7z44HNGj/mAn0NC85g4";

/** The fingerprint ssh shows for E2E_HOST_KEY. */
export const E2E_HOST_KEY_FINGERPRINT = `SHA256:${createHash("sha256")
  .update(Buffer.from(E2E_HOST_KEY.split(" ")[1] ?? "", "base64"))
  .digest("base64")
  .replace(/=+$/, "")}`;

/** The service's environment that hands it the key its scanner finds. */
export function hostKeyVariables(): Record<string, string> {
  return { OFFICE_E2E_HOST_KEY: E2E_HOST_KEY };
}
