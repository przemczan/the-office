import { roleRefusalSchema } from "@the-office/contracts";
import { expect } from "vitest";

export const PNG = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3);

export const SVG_WITH_A_SCRIPT = new TextEncoder().encode(
  "<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>",
);

export async function expectRefused(response: Response, reasons: readonly string[]): Promise<void> {
  expect(response.status).toBe(422);
  expect(roleRefusalSchema.parse(await response.json()).reasons).toEqual(reasons);
}
