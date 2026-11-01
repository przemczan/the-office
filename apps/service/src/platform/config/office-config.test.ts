import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { InvalidOfficeConfigError } from "./invalid-office-config-error.js";
import {
  isOfficeOwnVariable,
  readOfficeConfig,
  type EnvironmentVariables,
  type OfficeConfigDefaults,
} from "./office-config.js";

const port = "4310";
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
  it("reads the port, the database URL and the Office data directory", () => {
    const config = readOfficeConfig(
      { OFFICE_PORT: port, DATABASE_URL: databaseUrl, OFFICE_DATA_DIR: officeDataDirectory },
      platformDefaults(),
    );

    expect(config).toEqual({
      host: "127.0.0.1",
      port: 4310,
      databaseUrl,
      officeDataDirectory,
      gitHub: { webUrl: "https://github.com", apiUrl: "https://api.github.com" },
    });
  });

  it("reads where GitHub is, such as a fake GitHub server", () => {
    const config = readOfficeConfig(
      {
        OFFICE_PORT: port,
        DATABASE_URL: databaseUrl,
        OFFICE_GITHUB_URL: "http://127.0.0.1:4391",
        OFFICE_GITHUB_API_URL: "http://127.0.0.1:4391/api/v3",
      },
      platformDefaults(),
    );

    expect(config.gitHub).toEqual({
      webUrl: "http://127.0.0.1:4391",
      apiUrl: "http://127.0.0.1:4391/api/v3",
    });
  });

  it("refuses a GitHub URL that is not http or https", () => {
    const error = readProblems({
      OFFICE_PORT: port,
      DATABASE_URL: databaseUrl,
      OFFICE_GITHUB_URL: "ssh://github.com",
    });

    expect(error.problems).toEqual([
      { variable: "OFFICE_GITHUB_URL", problem: "must be an http:// or https:// URL" },
    ]);
  });

  it.each([
    ["unset", undefined, "127.0.0.1"],
    ["blank", "", "127.0.0.1"],
    ["every IPv4 address", "0.0.0.0", "0.0.0.0"],
    ["an IPv4 address", "10.1.1.70", "10.1.1.70"],
    ["an IPv6 address", "::", "::"],
  ])("reads OFFICE_HOST %s", (_, value, host) => {
    const config = readOfficeConfig(
      { OFFICE_HOST: value, OFFICE_PORT: port, DATABASE_URL: databaseUrl },
      platformDefaults(),
    );

    expect(config.host).toBe(host);
  });

  it.each(["localhost", "the-office.lan", "10.1.1", "10.1.1.70:4310"])(
    "refuses OFFICE_HOST %s, which is not an IP address",
    (value) => {
      const error = readProblems({
        OFFICE_HOST: value,
        OFFICE_PORT: port,
        DATABASE_URL: databaseUrl,
      });

      expect(error.problems).toEqual([
        { variable: "OFFICE_HOST", problem: "must be an IP address, such as 127.0.0.1 or 0.0.0.0" },
      ]);
    },
  );

  it("accepts the postgresql:// scheme", () => {
    const postgresqlUrl = "postgresql://office@localhost/the_office";

    const config = readOfficeConfig(
      { OFFICE_PORT: port, DATABASE_URL: postgresqlUrl },
      platformDefaults(),
    );

    expect(config.databaseUrl).toBe(postgresqlUrl);
  });

  it.each([
    ["unset", undefined],
    ["blank", ""],
  ])("uses the platform default when OFFICE_DATA_DIR is %s", (_, value) => {
    const config = readOfficeConfig(
      { OFFICE_PORT: port, DATABASE_URL: databaseUrl, OFFICE_DATA_DIR: value },
      platformDefaults(),
    );

    expect(config.officeDataDirectory).toBe(defaultOfficeDataDirectory);
  });

  it("does not ask the platform for a default when OFFICE_DATA_DIR is set", () => {
    const defaults = platformDefaults();

    readOfficeConfig(
      { OFFICE_PORT: port, DATABASE_URL: databaseUrl, OFFICE_DATA_DIR: officeDataDirectory },
      defaults,
    );

    expect(defaults.officeDataDirectory).not.toHaveBeenCalled();
  });

  it.each([
    ["unset", undefined],
    ["blank", ""],
  ])("refuses an OFFICE_PORT that is %s", (_, value) => {
    const error = readProblems({ OFFICE_PORT: value, DATABASE_URL: databaseUrl });

    expect(error.problems).toEqual([{ variable: "OFFICE_PORT", problem: "is required" }]);
  });

  it.each(["0", "65536", "43.1", "-1", "4310abc", " 4310"])(
    "refuses an OFFICE_PORT that is not a port number: %j",
    (value) => {
      const error = readProblems({ OFFICE_PORT: value, DATABASE_URL: databaseUrl });

      expect(error.problems).toEqual([
        { variable: "OFFICE_PORT", problem: "must be a port number from 1 to 65535" },
      ]);
    },
  );

  it.each([
    ["unset", undefined],
    ["blank", ""],
  ])("refuses a DATABASE_URL that is %s", (_, value) => {
    const error = readProblems({ OFFICE_PORT: port, DATABASE_URL: value });

    expect(error.problems).toEqual([{ variable: "DATABASE_URL", problem: "is required" }]);
  });

  it.each(["not a url", "mysql://office@127.0.0.1/the_office"])(
    "refuses a DATABASE_URL that is not a Postgres URL: %s",
    (value) => {
      const error = readProblems({ OFFICE_PORT: port, DATABASE_URL: value });

      expect(error.problems).toEqual([
        { variable: "DATABASE_URL", problem: "must be a postgres:// or postgresql:// URL" },
      ]);
    },
  );

  it("refuses a relative OFFICE_DATA_DIR", () => {
    const error = readProblems({
      OFFICE_PORT: port,
      DATABASE_URL: databaseUrl,
      OFFICE_DATA_DIR: "office-data",
    });

    expect(error.problems).toEqual([
      { variable: "OFFICE_DATA_DIR", problem: "must be an absolute path" },
    ]);
  });

  it("names every bad variable in one error", () => {
    const error = readProblems({ OFFICE_DATA_DIR: "office-data" });

    expect(error.message).toBe(
      [
        "The Office cannot start: fix these environment variables (see .env.example).",
        "  OFFICE_PORT: is required",
        "  DATABASE_URL: is required",
        "  OFFICE_DATA_DIR: must be an absolute path",
      ].join("\n"),
    );
  });

  it("keeps variable values, such as the database password, out of the error", () => {
    const error = readProblems({
      OFFICE_PORT: port,
      DATABASE_URL: "https://office:secret-password@127.0.0.1/the_office",
    });

    expect(error.message).not.toContain("secret-password");
  });
});

describe("isOfficeOwnVariable", () => {
  it.each([
    "OFFICE_PORT",
    "DATABASE_URL",
    "database_url",
    "OFFICE_DATA_DIR",
    "POSTGRES_PASSWORD",
    "COMPOSE_PROFILES",
    "GRAFANA_PORT",
    "OTEL_EXPORTER_OTLP_ENDPOINT",
    "npm_config_local_prefix",
    "npm_lifecycle_event",
    "NPM_CLI_JS",
    "INIT_CWD",
    "NODE",
    "NODE_ENV",
    "GH_TOKEN",
    "GITHUB_TOKEN",
    "gh_enterprise_token",
    "GITHUB_ENTERPRISE_TOKEN",
  ])("knows %s as The Office's own", (name) => {
    expect(isOfficeOwnVariable(name)).toBe(true);
  });

  it.each(["PATH", "Path", "HOME", "JAVA_HOME", "NODE_OPTIONS", "NODE_EXTRA_CA_CERTS", "CI"])(
    "leaves %s to the Project",
    (name) => {
      expect(isOfficeOwnVariable(name)).toBe(false);
    },
  );
});
