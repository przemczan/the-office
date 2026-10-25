import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

/** Saved on every run, for a person to compare with the click-through's. */
const SCREENSHOTS = path.resolve(import.meta.dirname, "../e2e-results/screenshots");

/** Written by this file alone, so the other files' skills never meet it. */
const SKILL = "people-handover";

// One person fills each Role and the database lives for the whole run, so the tests build on each
// other's hires; this is the only file that hires.
test.describe.configure({ mode: "serial" });

test.use({ colorScheme: "light", viewport: { width: 1600, height: 900 } });

async function hireFromPreset(page: Page, preset: string, name: string): Promise<void> {
  await page.goto("/people");
  await page.getByRole("button", { name: "Hire a Role" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByText(preset, { exact: true }).click();
  await dialog.getByLabel("Name", { exact: true }).fill(name);
  await dialog.getByRole("button", { name: `Hire ${name}` }).click();
  await expect(page.getByRole("heading", { name: `${name} · ${preset}` })).toBeVisible();
}

function roleCardGroup(page: Page, group: string) {
  return page.getByRole("region", { name: group });
}

test("the user hires the Planner, a Developer and a Reviewer from the presets", async ({
  page,
}) => {
  await hireFromPreset(page, "Planner", "Jan");
  await expect(page).toHaveURL(/\/people\/planner$/);
  await hireFromPreset(page, "Developer", "Ada");
  await hireFromPreset(page, "Reviewer", "Ola");

  await page.goto("/people");
  await expect(page.getByText("3 people")).toBeVisible();
  for (const name of ["Jan", "Ada", "Ola"]) {
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  }
  // Every preset is filled, and hiring from scratch comes later.
  await expect(page.getByRole("button", { name: "Hire a Role" })).toHaveCount(0);
  await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-people.png") });
});

test("a person's page shows who they are and their Role card from the presets", async ({
  page,
}) => {
  await page.goto("/people");
  await page.getByRole("link", { name: /Jan\s*Planner/ }).click();
  await expect(page).toHaveURL(/\/people\/planner$/);
  await expect(page.getByRole("heading", { name: "Who Jan is" })).toBeVisible();
  await expect(page.getByText("Up to 2 Tasks")).toBeVisible();
  await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-person-overview.png") });

  await page.goto("/people/developer");
  await page.getByRole("tab", { name: "Role card" }).click();
  await expect(page).toHaveURL(/\/people\/developer\/role$/);
  const permissions = roleCardGroup(page, "Permissions");
  await expect(permissions).toContainText("Run installsConsult Devops");
  await expect(permissions).toContainText("Publish outside the PipelineConsult CTO");
  await expect(permissions).toContainText("Asks you until someone is hired");
  await expect(permissions).toContainText("Change RolesNever");
  await expect(roleCardGroup(page, "Work")).toContainText("3 at once");
  await expect(roleCardGroup(page, "Engine")).toContainText("Opus 5.5 · effort high");
  await expect(page.getByText("Hired", { exact: true })).toBeVisible();
  await page.screenshot({
    path: path.join(SCREENSHOTS, "light-1600-person-role-card.png"),
    fullPage: true,
  });
});

test("the user edits every field of a Role card, and it holds after a reload", async ({ page }) => {
  const written = await page.request.post("/api/skills", {
    data: { name: SKILL, description: "Writes the Handover note.", instructions: "Three lines." },
  });
  expect(written.status()).toBe(201);
  await page.request.put(`/api/skills/${SKILL}/state`, { data: { state: "on" } });

  await page.goto("/people/developer/role");
  await page.getByRole("button", { name: "Edit Role" }).click();
  await expect(page).toHaveURL(/\/people\/developer\/role\/edit$/);
  const form = page.locator("form.role-card-form");
  await form.getByLabel("Name", { exact: true }).fill("Adam");
  await form.getByLabel("Title", { exact: true }).fill("Senior developer");
  await form.getByLabel("Responsibilities").fill("Implements Plans and keeps the tests green.");
  await form.getByLabel("Instructions").fill("Work from the Plan.\n\nAsk the user: a public API.");
  await form.getByLabel("Task limit").selectOption("4");
  await form.getByText("Prefer to continue", { exact: true }).click();
  await form.getByLabel("Model").selectOption("claude-sonnet-5-5");
  await form.getByRole("tab", { name: "Max" }).click();
  await form.getByText("Chat", { exact: true }).click();
  await form.getByText("Consultant", { exact: true }).click();
  await form.getByLabel("Run installs").selectOption("ask-me");
  await form.getByLabel("Publish outside the Pipeline").selectOption("never");
  await form.getByText(SKILL, { exact: true }).click();
  await expect(
    form.locator("label").filter({ hasText: SKILL }).getByRole("checkbox"),
  ).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText("You have unsaved changes.")).toBeVisible();
  await page.screenshot({
    path: path.join(SCREENSHOTS, "light-1600-role-card-form.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect(
    page.getByText("Role card saved. Adam works with it from the next session."),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/people\/developer\/role$/);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Adam · Senior developer" })).toBeVisible();
  await expect(roleCardGroup(page, "Identity")).toContainText(
    "Implements Plans and keeps the tests green.",
  );
  await expect(roleCardGroup(page, "Work")).toContainText("Ask the user: a public API.");
  await expect(roleCardGroup(page, "Work")).toContainText("4 at once");
  await expect(roleCardGroup(page, "Work")).toContainText("Prefer to continue");
  await expect(roleCardGroup(page, "Engine")).toContainText("Sonnet 5.5 · effort max");
  const capabilities = roleCardGroup(page, "Capabilities").getByRole("listitem");
  await expect(capabilities.filter({ hasText: "Chat" })).toHaveClass("on");
  await expect(capabilities.filter({ hasText: "Consultant" })).toHaveClass("on");
  const permissions = roleCardGroup(page, "Permissions");
  await expect(permissions).toContainText("Run installsAsk me");
  await expect(permissions).toContainText("Publish outside the PipelineNever");
  await expect(permissions).not.toContainText("Asks you until someone is hired");
  await expect(roleCardGroup(page, "Skills")).toContainText(SKILL);

  const changes = page.getByRole("listitem").filter({ hasText: "Role card version 2" });
  await expect(changes).toContainText("Model Opus 5.5 → Sonnet 5.5");
  await expect(changes).toContainText("Task limit 3 → 4");
  await expect(page.getByText(`Skills gained ${SKILL}`)).toBeVisible();
  await page.screenshot({
    path: path.join(SCREENSHOTS, "light-1600-role-card-changed.png"),
    fullPage: true,
  });
});

test("a Role card the service refuses names every reason, and keeps what was typed", async ({
  page,
}) => {
  await page.goto("/people/reviewer/role/edit");
  const form = page.locator("form.role-card-form");
  await form.getByLabel("Name", { exact: true }).fill("");
  await form.getByLabel("Responsibilities").fill("First paragraph.\n\nSecond paragraph.");
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect(page.getByText("The Role card can't be saved yet")).toBeVisible();
  await expect(page.getByText("Give the person a name.")).toBeVisible();
  await expect(page.getByText("The responsibilities are one paragraph.")).toBeVisible();
  await expect(form.getByLabel("Responsibilities")).toHaveValue(
    "First paragraph.\n\nSecond paragraph.",
  );
});

test("Assign… in Settings › Skills gives a skill to the people chosen", async ({ page }) => {
  await page.goto("/settings/skills");
  await page
    .getByRole("row")
    .filter({ hasText: SKILL })
    .getByRole("button", { name: "Assign…" })
    .click();
  const dialog = page.getByRole("dialog");
  for (const person of ["Jan · Planner", "Adam · Senior developer", "Ola · Reviewer"]) {
    await expect(dialog.getByText(person)).toBeVisible();
  }
  await dialog.getByText("Ola · Reviewer").click();
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.goto("/people/reviewer");
  await expect(page.getByText(SKILL, { exact: true })).toBeVisible();
});

test.describe("dark", () => {
  test.use({ colorScheme: "dark" });

  test("the Role card form keeps its unsaved-changes bar readable", async ({ page }) => {
    await page.goto("/people/planner/role/edit");
    await page.locator("form.role-card-form").getByText("Chat", { exact: true }).click();
    await expect(page.getByText("You have unsaved changes.")).toBeVisible();
    await page.screenshot({ path: path.join(SCREENSHOTS, "dark-1600-role-card-form.png") });
  });
});

test("a Role nobody fills has no page", async ({ page }) => {
  await page.goto("/people/cto");
  await expect(page.getByRole("link", { name: "Back to People" })).toBeVisible();
});
