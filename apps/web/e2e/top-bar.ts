import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Opens the top bar's Create and chooses what to create at its top: Task, chosen as it opens, shows
 * New Task, and Idea Capture an Idea, its title field focused.
 */
export async function createFromTopBar(page: Page, item: "Task" | "Idea"): Promise<void> {
  await page.getByRole("button", { name: "Create", exact: true }).click();
  const choice = page.getByRole("dialog").getByRole("tab", { name: item, exact: true });
  if (item === "Idea") await choice.click();
  await expect(choice).toHaveAttribute("aria-selected", "true");
}

/** Opens the top bar's user menu, named by the signed-in user's name, and answers the menu. */
export async function openUserMenu(page: Page, userName: string): Promise<Locator> {
  await page.getByRole("button", { name: `User menu: ${userName}`, exact: true }).click();
  return page.getByRole("menu");
}
