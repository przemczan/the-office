import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Authenticators, Passwords } from "./modules/users/index.js";
import {
  signedInCookie,
  turnOnAuthenticator,
  addUser,
  send,
  setCookieOf,
  startUsersApplication,
  type UserForTests,
  type UsersApplication,
} from "./modules/users/index.fixtures.js";
import {
  setPasswordCommand,
  type SetPasswordConsole,
  type SetPasswordServices,
} from "./set-password-command.js";

const NEW_PASSWORD = "a brand new password";

let office: UsersApplication;
let user: UserForTests;

beforeEach(async () => {
  office = await startUsersApplication();
  user = await addUser(office.app);
});

afterEach(async () => {
  await office.app.close();
});

/** A terminal that types the given answers, and keeps what the command wrote. */
function terminalTyping(
  typed: readonly string[],
  interactive = true,
): SetPasswordConsole & { readonly written: string[]; readonly asked: string[] } {
  const answers = [...typed];
  const written: string[] = [];
  const asked: string[] = [];
  return {
    interactive,
    written,
    asked,
    askHidden: (question) => {
      asked.push(question);
      return Promise.resolve(answers.shift() ?? "");
    },
    readPiped: () => Promise.resolve(answers.shift() ?? ""),
    info: (line) => void written.push(line),
    error: (line) => void written.push(`error: ${line}`),
  };
}

function services(): SetPasswordServices {
  return { passwords: office.app.get(Passwords), authenticators: office.app.get(Authenticators) };
}

function signIn(password: string): ReturnType<typeof send> {
  return send(office.port, {
    method: "POST",
    path: "/api/sign-in/password",
    body: { email: user.email, password },
  });
}

describe("npm run set-password", () => {
  it("sets a new password, lifts the lockout and signs out all the user's devices", async () => {
    office.schedule.setTime(new Date("2026-11-13T09:00:00.000Z"));
    const { cookie } = setCookieOf(await signIn(user.password));
    for (let index = 0; index < 10; index += 1) {
      await signIn("not the password at all");
      await office.schedule.advanceBy(16_000);
    }
    expect(await signIn(user.password)).toMatchObject({
      status: 429,
      body: { refusal: "locked" },
    });

    const terminal = terminalTyping([NEW_PASSWORD, NEW_PASSWORD]);
    const code = await setPasswordCommand(
      ["--email", user.email.toUpperCase()],
      terminal,
      services(),
    );

    expect(code).toBe(0);
    expect(terminal.asked).toEqual(["New password: ", "The new password again: "]);
    expect((await send(office.port, { path: "/api/account", headers: { cookie } })).status).toBe(
      401,
    );
    expect((await signIn(user.password)).status).toBe(422);
    expect((await signIn(NEW_PASSWORD)).status).toBe(200);
  });

  it("with --clear-authenticator, also removes the authenticator and recovery codes and lifts the code lockout", async () => {
    office.schedule.setTime(new Date("2026-11-13T09:00:00.000Z"));
    const cookie = await signedInCookie(`http://localhost:${office.port}`, user);
    await turnOnAuthenticator(office.port, cookie, office.schedule.now());
    const pending = setCookieOf(await signIn(user.password), "office_pending_sign_in").cookie;
    for (let index = 0; index < 10; index += 1) {
      await send(office.port, {
        method: "POST",
        path: "/api/sign-in/code",
        headers: { cookie: pending },
        body: { recoveryCode: "AAAAA-AAAAA" },
      });
      await office.schedule.advanceBy(16_000);
    }
    expect(await signIn(user.password)).toMatchObject({ status: 429, body: { refusal: "locked" } });

    const terminal = terminalTyping([NEW_PASSWORD, NEW_PASSWORD]);
    const exitCode = await setPasswordCommand(
      ["--email", user.email, "--clear-authenticator"],
      terminal,
      services(),
    );

    expect(exitCode).toBe(0);
    expect(terminal.written).toContain("Their authenticator and recovery codes are removed.");
    expect(await office.app.get(Authenticators).stateOf(user.id)).toEqual({ state: "off" });
    expect(await signIn(NEW_PASSWORD)).toMatchObject({
      status: 200,
      body: { outcome: "signed-in" },
    });
  });

  it("leaves the authenticator on without --clear-authenticator", async () => {
    const cookie = await signedInCookie(`http://localhost:${office.port}`, user);
    await turnOnAuthenticator(office.port, cookie, office.schedule.now());

    await setPasswordCommand(
      ["--email", user.email],
      terminalTyping([NEW_PASSWORD, NEW_PASSWORD]),
      services(),
    );

    expect(await signIn(NEW_PASSWORD)).toMatchObject({
      status: 200,
      body: { outcome: "code-needed" },
    });
  });

  it("reads the password from standard input when it isn't a terminal", async () => {
    const code = await setPasswordCommand(
      [`--email=${user.email}`],
      terminalTyping([NEW_PASSWORD], false),
      services(),
    );

    expect(code).toBe(0);
    expect((await signIn(NEW_PASSWORD)).status).toBe(200);
  });

  it("ends non-zero with a message for an unknown email, asking nothing", async () => {
    const terminal = terminalTyping([NEW_PASSWORD, NEW_PASSWORD]);

    const code = await setPasswordCommand(["--email", "nobody@example.com"], terminal, services());

    expect(code).toBe(1);
    expect(terminal.asked).toEqual([]);
    expect(terminal.written).toEqual(["error: No user has the email nobody@example.com."]);
  });

  it("changes nothing when the two passwords differ or the rules refuse it", async () => {
    const differ = terminalTyping([NEW_PASSWORD, `${NEW_PASSWORD}!`]);
    const tooShort = terminalTyping(["short", "short"]);
    const passwords = services();

    expect(await setPasswordCommand(["--email", user.email], differ, passwords)).toBe(1);
    expect(await setPasswordCommand(["--email", user.email], tooShort, passwords)).toBe(1);
    expect(differ.written).toEqual(["error: The two passwords differ; nothing was changed."]);
    expect(tooShort.written).toEqual(["error: A password has at least 12 characters."]);
    expect((await signIn(user.password)).status).toBe(200);
  });

  it("asks for an email", async () => {
    const terminal = terminalTyping([]);

    expect(await setPasswordCommand([], terminal, services())).toBe(2);
    expect(terminal.written).toEqual([
      "error: Usage: npm run set-password -- --email <email> [--clear-authenticator]",
    ]);
  });
});
