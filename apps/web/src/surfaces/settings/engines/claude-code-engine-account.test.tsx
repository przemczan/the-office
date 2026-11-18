import type { EngineAccount } from "@the-office/contracts";
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  buttonNamed,
  closePage,
  openPage,
  stubService,
  typed,
  until,
  type Sent,
} from "../../../shell/page.fixtures.tsx";
import { ClaudeCodeEngineAccount } from "./claude-code-engine-account.tsx";

const ACCOUNT = "GET /api/settings/engines/work/account";
const API_KEY = "PUT /api/settings/engines/work/api-key";
const SIGNED_OUT: EngineAccount = {
  signedIn: false,
  pastedToken: false,
  apiKey: false,
  email: null,
  plan: null,
};
const REFUSAL = "That is no Anthropic API key: one starts with sk-ant-api.";

/** The account of engine `work`, its API key taken when shaped `sk-ant-api…`, refused otherwise. */
async function openAccount(): Promise<{ readonly page: HTMLElement; readonly sent: Sent[] }> {
  let account = SIGNED_OUT;
  const sent = stubService({
    [ACCOUNT]: () => ({ status: 200, body: account }),
    [API_KEY]: (body) => {
      const { key } = body as { key: string };
      if (!key.startsWith("sk-ant-api")) return { status: 400, body: { message: REFUSAL } };
      account = { ...SIGNED_OUT, signedIn: true, apiKey: true };
      return { status: 204 };
    },
  });
  const { page } = await openPage("/", { "/": () => <ClaudeCodeEngineAccount engineId="work" /> });
  await until(() => expect(page.textContent).toContain("Signed out"));
  return { page, sent };
}

function press(page: HTMLElement, name: string): void {
  const button = buttonNamed(page, name);
  if (!button) throw new Error(`There is no ${name} button.`);
  act(() => button.click());
}

function keyField(page: HTMLElement): HTMLInputElement | null {
  return page.querySelector<HTMLInputElement>('input[type="password"]');
}

afterEach(closePage);

describe("a Claude Code engine's Use an API key", () => {
  it("shows the service's refusal of a key that isn't an Anthropic one, keeping what was typed", async () => {
    const { page, sent } = await openAccount();

    press(page, "Use an API key");
    expect(buttonNamed(page, "Use an API key")).toBeUndefined();
    typed(page, "API key", "sk-not-anthropic");
    press(page, "Save the API key");

    await until(() => expect(page.textContent).toContain(REFUSAL));
    expect(page.textContent).toContain("The API key wasn't saved");
    expect(sent.filter(({ request }) => request === API_KEY)).toEqual([
      { request: API_KEY, body: { key: "sk-not-anthropic" } },
    ]);
    expect(keyField(page)?.value).toBe("sk-not-anthropic");
  });

  it("sends the key, reads the account again and forgets the key once saved", async () => {
    const { page, sent } = await openAccount();

    press(page, "Use an API key");
    typed(page, "API key", "sk-ant-api03-ada");
    press(page, "Save the API key");

    await until(() => expect(page.textContent).toContain("An API key signs it in"));
    expect(sent).toContainEqual({ request: API_KEY, body: { key: "sk-ant-api03-ada" } });
    expect(keyField(page)).toBeNull();
    expect(page.textContent).not.toContain("sk-ant-api03-ada");

    press(page, "Use an API key");
    expect(keyField(page)?.value).toBe("");
  });
});
