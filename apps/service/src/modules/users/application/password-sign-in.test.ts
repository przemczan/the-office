import { signInRefusalSchema } from "@the-office/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addUser, type UserForTests } from "../index.fixtures.js";
import {
  send,
  startUsersApplication,
  type Answer,
  type UsersApplication,
} from "../users-application.fixtures.js";

const NOW = new Date("2026-11-13T09:00:00.000Z");
const SECOND = 1000;
const MINUTE = 60 * SECOND;

let office: UsersApplication;
let user: UserForTests;

beforeEach(async () => {
  office = await startUsersApplication();
  office.schedule.setTime(NOW);
  user = await addUser(office.app);
});

afterEach(async () => {
  await office.app.close();
});

function signIn(email: string, password: string, on = office): Promise<Answer> {
  return send(on.port, {
    method: "POST",
    path: "/api/sign-in/password",
    body: { email, password },
  });
}

/** The answer as the sign-in page reads it: its status, refusal and seconds until the next try. */
function refusalOf(answer: Answer, on = office): unknown {
  if (answer.status === 200) return { status: 200 };
  const { refusal, tryAgainAt } = signInRefusalSchema.parse(answer.body);
  return {
    status: answer.status,
    refusal,
    ...(tryAgainAt !== undefined && {
      waitSeconds: (Date.parse(tryAgainAt) - on.schedule.now().getTime()) / SECOND,
    }),
  };
}

async function wrongTry(email = user.email): Promise<unknown> {
  return refusalOf(await signIn(email, "not the password at all"));
}

describe("wrong passwords", () => {
  it("cost nothing three times, then slow down, then lock out for longer each time", async () => {
    for (let index = 0; index < 3; index += 1) {
      expect(await wrongTry()).toEqual({ status: 422, refusal: "wrong" });
    }
    expect(await wrongTry()).toEqual({ status: 422, refusal: "wrong", waitSeconds: 2 });
    // Too soon: the try isn't taken, the right password included.
    expect(refusalOf(await signIn(user.email, user.password))).toEqual({
      status: 429,
      refusal: "slow-down",
      waitSeconds: 2,
    });

    for (const waitSeconds of [4, 8, 16, 16, 16]) {
      await office.schedule.advanceBy(16 * SECOND);
      expect(await wrongTry()).toEqual({ status: 422, refusal: "wrong", waitSeconds });
    }
    await office.schedule.advanceBy(16 * SECOND);
    expect(await wrongTry()).toEqual({ status: 429, refusal: "locked", waitSeconds: 15 * 60 });
    expect(refusalOf(await signIn(user.email, user.password))).toEqual({
      status: 429,
      refusal: "locked",
      waitSeconds: 15 * 60,
    });

    await office.schedule.advanceBy(15 * MINUTE);
    expect(await wrongTry()).toEqual({ status: 429, refusal: "locked", waitSeconds: 30 * 60 });

    await office.schedule.advanceBy(30 * MINUTE);
    expect(refusalOf(await signIn(user.email, user.password))).toEqual({ status: 200 });
    // A right sign-in resets the count.
    expect(await wrongTry()).toEqual({ status: 422, refusal: "wrong" });
  });

  it("are counted in the database, so a restart doesn't reset them", async () => {
    for (let index = 0; index < 4; index += 1) await wrongTry();
    await office.app.close();

    office = await startUsersApplication();
    office.schedule.setTime(NOW);

    expect(refusalOf(await signIn(user.email, user.password))).toEqual({
      status: 429,
      refusal: "slow-down",
      waitSeconds: 2,
    });
  });

  it("are all counted when sent at once", async () => {
    const answers = await Promise.all(
      Array.from({ length: 6 }, () => signIn(user.email, "not the password at all")),
    );

    // Only four tries are taken before the slow-down's wait; the rest wait for it.
    expect(answers.filter(({ status }) => status === 422)).toHaveLength(4);
    expect(answers.filter(({ status }) => status === 429)).toHaveLength(2);
  });
});

describe("an unknown email", () => {
  it("gets the same answers as a wrong password, slow-down included", async () => {
    const unknown = `nobody-${user.id}@example.com`;
    const answers: unknown[][] = [[], []];

    for (let index = 0; index < 5; index += 1) {
      answers[0]?.push(await wrongTry());
      answers[1]?.push(await wrongTry(unknown));
      await office.schedule.advanceBy(16 * SECOND);
    }

    expect(answers[1]).toEqual(answers[0]);
    expect(signInRefusalSchema.parse((await signIn(unknown, "x")).body).message).toBe(
      "The email or password is wrong.",
    );
  });
});
