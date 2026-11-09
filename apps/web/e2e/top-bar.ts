import type { Page } from "@playwright/test";

/** Opens the top bar's Create and picks what to create, which opens its dialog. */
export async function createFromTopBar(page: Page, item: "Task" | "Idea"): Promise<void> {
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await page.getByRole("menu").getByRole("button", { name: item, exact: true }).click();
}
