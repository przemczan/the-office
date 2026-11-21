import { describe, expect, it } from "vitest";
import { InvalidOfficeConfigError } from "./invalid-office-config-error.js";
import { isOfficeOwnVariable, readDatabaseUrl, readOfficeConfig } from "./office-config.js";
import {
  port,
  databaseUrl,
  officeDataDirectory,
  platformDefaults,
  readProblems,
} from "./office-config.fixtures.js";

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
      skipSetupBasics: false,
      testInstance: false,
    });
  });

  it.each([
    ["true", true],
    ["false", false],
    ["", false],
  ])("reads OFFICE_TEST_INSTANCE=%j as %s", (value, testInstance) => {
    const config = readOfficeConfig(
      { OFFICE_PORT: port, DATABASE_URL: databaseUrl, OFFICE_TEST_INSTANCE: value },
      platformDefaults(),
    );

    expect(config.testInstance).toBe(testInstance);
  });

  it("refuses OFFICE_TEST_INSTANCE other than true or false", () => {
    const error = readProblems({
      OFFICE_PORT: port,
      DATABASE_URL: databaseUrl,
      OFFICE_TEST_INSTANCE: "yes",
    });

    expect(error.problems).toEqual([
      { variable: "OFFICE_TEST_INSTANCE", problem: "must be true or false" },
    ]);
  });

  it.each([
    ["true", true],
    ["false", false],
    ["", false],
  ])("reads OFFICE_SKIP_SETUP_BASICS=%j as %s", (value, skipSetupBasics) => {
    const config = readOfficeConfig(
      { OFFICE_PORT: port, DATABASE_URL: databaseUrl, OFFICE_SKIP_SETUP_BASICS: value },
      platformDefaults(),
    );

    expect(config.skipSetupBasics).toBe(skipSetupBasics);
  });

  it("refuses OFFICE_SKIP_SETUP_BASICS other than true or false, and keeps it from Project commands", () => {
    const error = readProblems({
      OFFICE_PORT: port,
      DATABASE_URL: databaseUrl,
      OFFICE_SKIP_SETUP_BASICS: "yes",
    });

    expect(error.problems).toEqual([
      { variable: "OFFICE_SKIP_SETUP_BASICS", problem: "must be true or false" },
    ]);
    expect(isOfficeOwnVariable("OFFICE_SKIP_SETUP_BASICS")).toBe(true);
  });

  it("reads how The Office was installed, refuses another kind, and keeps it from Project commands", () => {
    const config = readOfficeConfig(
      { OFFICE_PORT: port, DATABASE_URL: databaseUrl, OFFICE_INSTALL: "container" },
      platformDefaults(),
    );
    const error = readProblems({
      OFFICE_PORT: port,
      DATABASE_URL: databaseUrl,
      OFFICE_INSTALL: "snap",
    });

    expect(config.officeInstall).toBe("container");
    expect(error.problems).toEqual([
      { variable: "OFFICE_INSTALL", problem: "must be checkout, release or container" },
    ]);
    expect(isOfficeOwnVariable("OFFICE_INSTALL")).toBe(true);
  });

  it("reads the public address as its origin", () => {
    const config = readOfficeConfig(
      {
        OFFICE_PORT: port,
        DATABASE_URL: databaseUrl,
        OFFICE_PUBLIC_ADDRESS: "https://Office.Example.com/",
      },
      platformDefaults(),
    );

    expect(config.publicAddress).toBe("https://office.example.com");
  });

  it.each([
    "http://office.example.com",
    "https://office.example.com/office",
    "https://office.example.com?x=1",
    "https://user@office.example.com",
    "office.example.com",
  ])("refuses %s as the public address", (address) => {
    const error = readProblems({
      OFFICE_PORT: port,
      DATABASE_URL: databaseUrl,
      OFFICE_PUBLIC_ADDRESS: address,
    });

    expect(error.problems).toEqual([
      {
        variable: "OFFICE_PUBLIC_ADDRESS",
        problem: "must be an https:// address with no path, such as https://office.example.com",
      },
    ]);
  });

  it("keeps variable values, such as the database password, out of the error", () => {
    const error = readProblems({
      OFFICE_PORT: port,
      DATABASE_URL: "https://office:secret-password@127.0.0.1/the_office",
    });

    expect(error.message).not.toContain("secret-password");
  });
});

describe("readDatabaseUrl", () => {
  it("reads the database URL alone, needing nothing the service listens with", () => {
    expect(readDatabaseUrl({ DATABASE_URL: databaseUrl })).toBe(databaseUrl);
  });

  it("refuses a missing database URL", () => {
    expect(() => readDatabaseUrl({ OFFICE_PORT: port })).toThrow(InvalidOfficeConfigError);
  });
});
