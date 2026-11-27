import { expect, test, type Page } from "@playwright/test";
import { threadSchema } from "@the-office/contracts";
import { queryOfficeDatabase } from "./office-database.ts";
import { screenshotScenario } from "./task-screenshots.ts";

/** A chat Thread with Sam, the Caretaker, titled; no message is sent, so no session opens. */
async function startTitledThread(page: Page, title: string): Promise<string> {
  const started = await page.request.post("/api/chats/caretaker/threads");
  expect(started.status()).toBe(201);
  const { id } = threadSchema.parse(await started.json());
  const titled = await page.request.put(`/api/threads/${id}/title`, { data: { title } });
  expect(titled.ok()).toBe(true);
  return id;
}

test("Stop shows while Sam answers, and Select deletes chat Threads after the window", async ({
  page,
}) => {
  const stamp = Date.now();
  const answeringTitle = `Stop and delete, answering ${stamp}`;
  const keptTitle = `Stop and delete, kept ${stamp}`;
  const answeringId = await startTitledThread(page, answeringTitle);
  const keptId = await startTitledThread(page, keptTitle);
  const plainId = await startTitledThread(page, `Stop and delete, plain ${stamp}`);
  // Only a session's turn makes a Thread answer; the Stop button reads the Thread's state alone.
  await queryOfficeDatabase(
    "UPDATE threads SET state = 'answering', answering_since = now() WHERE id = $1",
    [answeringId],
  );

  await page.goto(`/now?chat=caretaker&thread=${answeringId}`);
  const stop = page.getByRole("button", { name: "Stop Sam" });
  await expect(stop).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete the Thread" })).toBeEnabled();
  await screenshotScenario(page, "chat-stop-button", { inView: stop });

  await page.getByTitle("Every Thread with Sam").click();
  await page.getByRole("button", { name: "Select" }).click();
  const bar = page.getByRole("toolbar", { name: "Selected Threads" });
  await expect(bar.getByRole("button", { name: "Delete" })).toBeDisabled();
  await page.getByText(answeringTitle).click();
  await page.getByText(`Stop and delete, plain ${stamp}`).click();
  await expect(bar).toContainText("2 selected");
  await screenshotScenario(page, "chat-select-threads");

  await bar.getByRole("button", { name: "Delete" }).click();
  const window = page.getByRole("dialog", { name: "Delete 2 Threads with Sam?" });
  await expect(window).toContainText("Sam's answer in one of them is stopped first.");
  await screenshotScenario(page, "chat-delete-threads-window");

  await window.getByRole("button", { name: "Delete 2 Threads" }).click();
  await expect(page.getByText("2 Threads deleted")).toBeVisible();
  await expect(page.getByText(answeringTitle)).toHaveCount(0);
  await expect(page.getByText(keptTitle)).toBeVisible();
  for (const id of [answeringId, plainId]) {
    expect((await page.request.get(`/api/threads/${id}`)).status()).toBe(404);
  }
  expect((await page.request.get(`/api/threads/${keptId}`)).ok()).toBe(true);
});
