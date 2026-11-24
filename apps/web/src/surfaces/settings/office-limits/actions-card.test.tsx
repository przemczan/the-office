import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  buttonNamed,
  closePage,
  openPage,
  stubService,
  until,
} from "../../../shell/page.fixtures.tsx";
import { ActionsCard } from "./actions-card.tsx";

afterEach(closePage);

async function shown(): Promise<HTMLElement> {
  const { page } = await openPage("/", { "/": ActionsCard });
  await until(() => expect(page.querySelector("output")?.textContent).toBe("2"));
  return page;
}

describe("Settings › Office limits' Actions card", () => {
  it("saves Actions at once at each step, with its hint and foot", async () => {
    const sent = stubService({
      "GET /api/settings/actions": () => ({ status: 200, body: { actionsAtOnce: 2 } }),
      "PUT /api/settings/actions": (body) => ({ status: 200, body }),
    });
    const page = await shown();

    expect(page.textContent).toContain(
      "How many Project command runs of Actions may be running together across The Office. A Test target run counts as a test instance instead, a Workflow run toward neither.",
    );
    expect(page.textContent).toContain(
      "Lowering it stops none: the next start is refused until fewer are running.",
    );
    act(() => buttonNamed(page, "Raise Actions at once")?.click());

    await until(() => expect(page.querySelector("output")?.textContent).toBe("3"));
    expect(sent.find(({ request }) => request === "PUT /api/settings/actions")?.body).toEqual({
      actionsAtOnce: 3,
    });
  });

  it("shows a refusal under the card", async () => {
    stubService({
      "GET /api/settings/actions": () => ({ status: 200, body: { actionsAtOnce: 2 } }),
      "PUT /api/settings/actions": () => ({
        status: 400,
        body: { message: "Actions at once is a whole number from 1 to 6." },
      }),
    });
    const page = await shown();

    act(() => buttonNamed(page, "Lower Actions at once")?.click());

    await until(() =>
      expect(page.textContent).toContain("Actions at once is a whole number from 1 to 6."),
    );
  });
});
