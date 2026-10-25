import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { InvalidOfficeConfigError } from "./invalid-office-config-error.js";
import {
  readOfficeConfig,
  type EnvironmentVariables,
  type OfficeConfigDefaults,
} from "./office-config.js";

const databaseUrl = "postgres://office:secret-password@127.0.0.1:5432/the_office";
const officeDataDirectory = resolve("office-data");
const defaultOfficeDataDirectory = resolve("default-office-data");

function platformDefaults(): OfficeConfigDefaults {
  return { officeDataDirectory: vi.fn<() => string>(() => defaultOfficeDataDirectory) };
}

function readProblems(environment: EnvironmentVariables): InvalidOfficeConfigError {
  try {
    readOfficeConfig(environment, platformDefaults());
  } catch (error) {
    if (error instanceof InvalidOfficeConfigError) return error;
    throw error;
  }
  throw new Error("expected readOfficeConfig to refuse the environment");
}

describe("readOfficeConfig", () => {
  it("reads the database URL and the Office data directory", () => {
    const config = readOfficeConfig(
      { DATABASE_URL: databaseUrl, OFFICE_DATA_DIR: officeDataDirectory },
      platformDefaults(),
    );

    expect(config).toEqual({ databaseUrl, officeDataDirectory });
  });

  it("accepts the postgresql:// scheme", () => {
    const postgresqlUrl = "postgresql://office@localhost/the_office";

    const config = readOfficeConfig({ DATABASE_URL: postgresqlUrl }, platformDefaults());

    expect(config.databaseUrl).toBe(postgresqlUrl);
  });

  it.each([
    ["unset", undefined],
    ["blank", ""],
  ])("uses the platform default when OFFICE_DATA_DIR is %s", (_, value) => {
    const config = readOfficeConfig(
      { DATABASE_URL: databaseUrl, OFFICE_DATA_DIR: value },
      platformDefaults(),
    );

    expect(config.officeDataDirectory).toBe(defaultOfficeDataDirectory);
  });

  it("does not ask the platform for a default when OFFICE_DATA_DIR is set", () => {
    const defaults = platformDefaults();

    readOfficeConfig({ DATABASE_URL: databaseUrl, OFFICE_DATA_DIR: officeDataDirectory }, defaults);

    expect(defaults.officeDataDirectory).not.toHaveBeenCalled();
  });

  it.each([
    ["unset", undefined],
    ["blank", ""],
  ])("refuses a DATABASE_URL that is %s", (_, value) => {
    const error = readProblems({ DATABASE_URL: value });

    expect(error.problems).toEqual([{ variable: "DATABASE_URL", problem: "is required" }]);
  });

  it.each(["not a url", "mysql://office@127.0.0.1/the_office"])(
    "refuses a DATABASE_URL that is not a Postgres URL: %s",
    (value) => {
      const error = readProblems({ DATABASE_URL: value });

      expect(error.problems).toEqual([
        { variable: "DATABASE_URL", problem: "must be a postgres:// or postgresql:// URL" },
      ]);
    },
  );

  it("refuses a relative OFFICE_DATA_DIR", () => {
    const error = readProblems({ DATABASE_URL: databaseUrl, OFFICE_DATA_DIR: "office-data" });

    expect(error.problems).toEqual([
      { variable: "OFFICE_DATA_DIR", problem: "must be an absolute path" },
    ]);
  });

  it("names every bad variable in one error", () => {
    const error = readProblems({ OFFICE_DATA_DIR: "office-data" });

    expect(error.message).toBe(
      [
        "The Office cannot start: fix these environment variables (see .env.example).",
        "  DATABASE_URL: is required",
        "  OFFICE_DATA_DIR: must be an absolute path",
      ].join("\n"),
    );
  });

  it("keeps variable values, such as the database password, out of the error", () => {
    const error = readProblems({
      DATABASE_URL: "https://office:secret-password@127.0.0.1/the_office",
    });

    expect(error.message).not.toContain("secret-password");
  });
});
