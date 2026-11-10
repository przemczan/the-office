import { resolve } from "node:path";
import { vi } from "vitest";
import { InvalidOfficeConfigError } from "./invalid-office-config-error.js";
import {
  readOfficeConfig,
  type EnvironmentVariables,
  type OfficeConfigDefaults,
} from "./office-config.js";

export const port = "4310";

export const databaseUrl = "postgres://office:secret-password@127.0.0.1:5432/the_office";

export const officeDataDirectory = resolve("office-data");

export const defaultOfficeDataDirectory = resolve("default-office-data");

export function platformDefaults(): OfficeConfigDefaults {
  return { officeDataDirectory: vi.fn<() => string>(() => defaultOfficeDataDirectory) };
}

export function readProblems(environment: EnvironmentVariables): InvalidOfficeConfigError {
  try {
    readOfficeConfig(environment, platformDefaults());
  } catch (error) {
    if (error instanceof InvalidOfficeConfigError) return error;
    throw error;
  }
  throw new Error("expected readOfficeConfig to refuse the environment");
}
