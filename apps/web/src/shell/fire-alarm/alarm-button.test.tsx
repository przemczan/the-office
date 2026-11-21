import type { FireAlarmOnNow, FireAlarmWay, Now } from "@the-office/contracts";
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  buttonNamed,
  closePage,
  openPage,
  shownText,
  stubService,
  until,
  type Sent,
} from "../page.fixtures.tsx";
import { AlarmButton } from "./alarm-button.tsx";
import { FireAlarmReviewProvider } from "./fire-alarm-review.tsx";

const OFF: Now = {
  needsYou: [],
  running: [],
  queue: [],
  shaping: [],
  tokensToday: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
  desks: { inUse: 0, limit: 3 },
  usageWindows: [],
  fireAlarm: null,
};

function onIn(way: FireAlarmWay): Now {
  const fireAlarm: FireAlarmOnNow = {
    since: "2026-11-21T14:02:00.000Z",
    way,
    stopping: false,
    paused: [],
    goingOn: [],
    resumeTokens: 0,
  };
  return { ...OFF, fireAlarm };
}

async function openWith(
  now: Now,
  sound: () => { status: number; body: unknown },
): Promise<{
  readonly page: HTMLElement;
  readonly sent: Sent[];
}> {
  const sent = stubService({
    "GET /api/now": () => ({ status: 200, body: now }),
    "POST /api/fire-alarm/sound": sound,
  });
  const { page } = await openPage("/now", {
    now: () => (
      <FireAlarmReviewProvider>
        <AlarmButton />
      </FireAlarmReviewProvider>
    ),
  });
  return { page, sent };
}

/** The open menu's ways, by their names, each shown over its hint. */
function waysShown(): string[] {
  const menu = document.querySelector('[role="menu"]');
  if (!menu) throw new Error("The alarm's menu isn't open.");
  return [...menu.querySelectorAll(".alarm-way")].map(
    (way) => way.firstChild?.textContent?.trim() ?? "",
  );
}

function chooseWay(label: string): void {
  const way = [...document.querySelectorAll<HTMLButtonElement>('[role="menu"] button')].find(
    (button) => shownText(button).startsWith(label),
  );
  if (!way) throw new Error(`The menu offers no ${label}.`);
  act(() => way.click());
}

afterEach(closePage);

describe("the top bar's fire alarm", () => {
  it("offers the three ways to stop while it is off, and sounds the one chosen", async () => {
    const { page, sent } = await openWith(OFF, () => ({
      status: 200,
      body: { on: true, since: "2026-11-21T14:02:00.000Z", way: "after-stages" },
    }));
    await until(() => expect(buttonNamed(page, "Sound the alarm")).toBeDefined());

    act(() => buttonNamed(page, "Sound the alarm")?.click());

    expect(waysShown()).toEqual([
      "Safe pause ASAP",
      "Safe pause after the current Stages",
      "Safe pause after the current Tasks",
    ]);
    expect(document.body.textContent).toContain("Running Stages finish; no new Stage starts.");
    chooseWay("Safe pause after the current Stages");

    await until(() =>
      expect(document.body.textContent).toContain(
        "Alarm sounded: running Stages finish, then no new Stage starts. Chats keep their tools.",
      ),
    );
    expect(sent.find(({ request }) => request === "POST /api/fire-alarm/sound")?.body).toEqual({
      way: "after-stages",
    });
  });

  it("keeps today's toast for ASAP", async () => {
    const { page } = await openWith(OFF, () => ({
      status: 200,
      body: { on: true, since: "2026-11-21T14:02:00.000Z", way: "asap" },
    }));
    await until(() => expect(buttonNamed(page, "Sound the alarm")).toBeDefined());

    act(() => buttonNamed(page, "Sound the alarm")?.click());
    chooseWay("Safe pause ASAP");

    await until(() =>
      expect(document.body.textContent).toContain(
        "Alarm sounded: every Stage stops at its next safe point. Chats stay open.",
      ),
    );
  });

  it("offers All clear… and only the stricter ways while a softer way is on", async () => {
    const { page, sent } = await openWith(onIn("after-tasks"), () => ({
      status: 200,
      body: { on: true, since: "2026-11-21T14:02:00.000Z", way: "asap" },
    }));
    await until(() => expect(buttonNamed(page, "All clear…")).toBeDefined());
    expect(buttonNamed(page, "Sound the alarm")).toBeUndefined();

    act(() => buttonNamed(page, "Make the alarm stricter")?.click());

    expect(waysShown()).toEqual(["Safe pause ASAP", "Safe pause after the current Stages"]);
    chooseWay("Safe pause ASAP");

    await until(() =>
      expect(document.body.textContent).toContain(
        "Alarm made stricter: every Stage stops at its next safe point.",
      ),
    );
    expect(sent.find(({ request }) => request === "POST /api/fire-alarm/sound")?.body).toEqual({
      way: "asap",
    });
  });

  it("offers only ASAP after the current Stages, and shows a refusal in the service's words", async () => {
    const reason = "The fire alarm is on in a stricter way: only the all clear eases it.";
    const { page } = await openWith(onIn("after-stages"), () => ({
      status: 422,
      body: { statusCode: 422, message: reason, reasons: [reason] },
    }));
    await until(() => expect(buttonNamed(page, "Make the alarm stricter")).toBeDefined());

    act(() => buttonNamed(page, "Make the alarm stricter")?.click());

    expect(waysShown()).toEqual(["Safe pause ASAP"]);
    chooseWay("Safe pause ASAP");

    await until(() => expect(document.body.textContent).toContain(reason));
    expect(document.body.textContent).toContain("The alarm wasn't made stricter");
  });

  it("shows only All clear… while it is on ASAP", async () => {
    const { page } = await openWith(onIn("asap"), () => ({ status: 500, body: {} }));
    await until(() => expect(buttonNamed(page, "All clear…")).toBeDefined());

    expect(buttonNamed(page, "Make the alarm stricter")).toBeUndefined();
    expect(buttonNamed(page, "Sound the alarm")).toBeUndefined();
  });
});
