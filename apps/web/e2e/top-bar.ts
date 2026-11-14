import type { Locator, Page } from "@playwright/test";

/** Opens the top bar's Create and picks what to create, which opens its dialog. */
export async function createFromTopBar(page: Page, item: "Task" | "Idea"): Promise<void> {
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await page.getByRole("menu").getByRole("button", { name: item, exact: true }).click();
}

/** Opens the top bar's user menu, named by the signed-in user's name, and answers the menu. */
export async function openUserMenu(page: Page, userName: string): Promise<Locator> {
  await page.getByRole("button", { name: `User menu: ${userName}`, exact: true }).click();
  return page.getByRole("menu");
}
