import { describe, expect, it } from "vitest";
import { readOfficeConfig } from "./office-config.js";
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
    });
  });

  it("keeps variable values, such as the database password, out of the error", () => {
    const error = readProblems({
      OFFICE_PORT: port,
      DATABASE_URL: "https://office:secret-password@127.0.0.1/the_office",
    });

    expect(error.message).not.toContain("secret-password");
  });
});
