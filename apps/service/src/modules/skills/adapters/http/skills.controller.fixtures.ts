import { randomUUID } from "node:crypto";
import { skillRefusalSchema } from "@the-office/contracts";
import { expect } from "vitest";

/** A name of the test's own, since every test file shares the database. */
export function aName(): string {
  return `notes-${randomUUID().slice(0, 8)}`;
}

export async function reasonsOf(response: Response): Promise<string[]> {
  expect(response.status).toBe(422);
  return skillRefusalSchema.parse(await response.json()).reasons;
}

export const skillMd = (name: string) =>
  `---\nname: ${name}\ndescription: Writes release notes.\n---\nGroup them.\n`;
