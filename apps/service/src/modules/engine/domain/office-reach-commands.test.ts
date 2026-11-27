import { describe, expect, it } from "vitest";
import { officeReach, type OfficeReach } from "./office-reach-commands.js";

const REACH: OfficeReach = {
  apiPort: 4390,
  databaseUrl: "postgres://office:secret@db.internal:5433/the_office",
};

const reaches = (...words: string[]) => officeReach(words, REACH);

describe("officeReach", () => {
  it("names a loopback host with exactly the API's port, as host:port or as separate words", () => {
    for (const words of [
      ["curl", "http://localhost:4390/api/tasks"],
      ["curl", "http://127.0.0.1:4390/api/tasks"],
      ["curl", "http://127.1.2.3:4390/"],
      ["curl", "http://0.0.0.0:4390/"],
      ["curl", "http://[::1]:4390/api/tasks"],
      ["curl", "-H", "x: y", "localhost:4390"],
      ["nc", "localhost", "4390"],
      ["nc", "::1", "4390"],
    ]) {
      expect(reaches(...words)).toBeDefined();
    }
  });

  it("lets through /api/health, whatever the host", () => {
    expect(reaches("curl", "http://localhost:4390/api/health")).toBeUndefined();
    expect(reaches("curl", "http://[::1]:4390/api/health?x=1")).toBeUndefined();
    expect(reaches("curl", "http://localhost:4390/api/healthy")).toBeDefined();
  });

  it("never matches a port alone, a host alone or another port", () => {
    expect(reaches("echo", "4390")).toBeUndefined();
    expect(reaches("curl", "http://localhost/")).toBeUndefined();
    expect(reaches("curl", "http://localhost:43901/")).toBeUndefined();
    expect(reaches("curl", "http://localhost:3000/")).toBeUndefined();
    expect(reaches("curl", "http://example.com:4390/")).toBeUndefined();
  });

  it("refuses the database's full URL, or its name with its exact host and port", () => {
    expect(reaches("psql", REACH.databaseUrl)).toBeDefined();
    expect(reaches("psql", "-h", "db.internal", "-p", "5433", "-d", "the_office")).toBeDefined();
    expect(reaches("psql", "postgres://x@db.internal:5433/the_office")).toBeDefined();
  });

  it("never matches a bare database name, a host alone or a port alone", () => {
    expect(reaches("grep", "the_office", "notes.md")).toBeUndefined();
    expect(reaches("ping", "db.internal")).toBeUndefined();
    expect(reaches("psql", "-p", "5433")).toBeUndefined();
    expect(reaches("psql", "-h", "db.internal", "-d", "the_office")).toBeUndefined();
  });
});
