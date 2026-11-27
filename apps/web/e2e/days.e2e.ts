import { expect, test } from "@playwright/test";

test.describe("Work › Days", () => {
  test("opens from Work's tabs on today, and steps back a day that can be linked to", async ({
    page,
  }) => {
    await page.goto("/work");
    await page.getByRole("tab", { name: "Days", exact: true }).click();
    await expect(page).toHaveURL(/\/work\/days$/);
    // Today is the service's answer; the next day isn't open to choose.
    await expect(page.getByRole("heading", { name: "Today, so far" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Next day" })).toBeDisabled();

    await page.getByRole("button", { name: "Yesterday" }).click();
    await expect(page).toHaveURL(/\/work\/days\?day=\d{4}-\d{2}-\d{2}$/);
    await expect(page.getByRole("heading", { name: "Today, so far" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Next day" })).toBeEnabled();
  });
});
