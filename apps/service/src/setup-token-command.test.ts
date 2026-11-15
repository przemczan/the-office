import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { freshTestDatabase, type FreshTestDatabase } from "../test/test-database.js";
import { FirstRunSetup } from "./modules/users/index.js";
import {
  addUser,
  send,
  startUsersApplication,
  type UsersApplication,
} from "./modules/users/index.fixtures.js";
import { addressToOpen } from "./platform/config/address-to-open.js";
import { setupTokenCommand, type SetupTokenConsole } from "./setup-token-command.js";

const TOKEN = /^(\w{4}-){5}\w{4}$/;

let database: FreshTestDatabase;
let office: UsersApplication;

beforeEach(async () => {
  database = await freshTestDatabase();
  office = await startUsersApplication({ databaseUrl: database.url });
});

afterEach(async () => {
  await office.app.close();
  await database.drop();
});

function terminal(): SetupTokenConsole & { readonly written: string[] } {
  const written: string[] = [];
  return {
    written,
    info: (line) => void written.push(line),
    error: (line) => void written.push(`error: ${line}`),
  };
}

function run(args: readonly string[], console: SetupTokenConsole): Promise<number> {
  return setupTokenCommand(args, console, {
    firstRunSetup: office.app.get(FirstRunSetup),
    addressToOpen: "http://localhost:4310",
  });
}

function createFirstUser(setupToken: string): ReturnType<typeof send> {
  return send(office.port, {
    method: "POST",
    path: "/api/sign-in/first-user",
    body: {
      setupToken,
      name: "Ada Lovelace",
      email: "ada@example.com",
      password: "a long password",
    },
  });
}

describe("npm run setup-token", () => {
  it("prints a new token with where to open The Office, ending the earlier one", async () => {
    const first = terminal();
    expect(await run([], first)).toBe(0);
    const second = terminal();
    expect(await run([], second)).toBe(0);

    expect(second.written).toEqual([
      expect.stringMatching(/^Setup token: (\w{4}-){5}\w{4}$/),
      "Open http://localhost:4310 and give it this token to create the first user.",
      "Any earlier setup token no longer works.",
    ]);
    const earlier = (first.written[0] ?? "").replace("Setup token: ", "");
    const current = (second.written[0] ?? "").replace("Setup token: ", "");
    expect((await createFirstUser(earlier)).status).toBe(403);
    expect((await createFirstUser(current)).status).toBe(201);
  });

  it("prints only the token with --quiet", async () => {
    const quiet = terminal();

    expect(await run(["--quiet"], quiet)).toBe(0);
    expect(quiet.written).toEqual([expect.stringMatching(TOKEN)]);
  });

  it("exits with 1 and says why once a user exists, and 2 for other arguments", async () => {
    await addUser(office.app);
    const refused = terminal();
    expect(await run(["--quiet"], refused)).toBe(1);
    expect(refused.written).toEqual([expect.stringContaining("npm run set-password")]);

    const wrong = terminal();
    expect(await run(["--loud"], wrong)).toBe(2);
    expect(wrong.written).toEqual(["error: Usage: npm run setup-token [-- --quiet]"]);
  });
});

describe("addressToOpen", () => {
  it.each([
    [{ host: "127.0.0.1", port: 4310 }, "http://localhost:4310"],
    [{ host: "0.0.0.0", port: 4310 }, "http://localhost:4310"],
    [{ host: "192.168.1.20", port: 4310 }, "http://192.168.1.20:4310"],
    [{ host: "fd00::20", port: 4310 }, "http://[fd00::20]:4310"],
    [
      { host: "127.0.0.1", port: 4310, publicAddress: "https://office.example.com" },
      "https://office.example.com",
    ],
  ])("opens %j at %s", (config, address) => {
    expect(addressToOpen(config)).toBe(address);
  });
});
