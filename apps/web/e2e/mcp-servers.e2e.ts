import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { CONNECTING, FAKE_MCP_SERVER, FAKE_MCP_TOOLS } from "./fake-mcp-server.ts";

/** Saved on every run, for a person to look over. */
const SCREENSHOTS = path.resolve(import.meta.dirname, "../e2e-results/screenshots");

test.use({ colorScheme: "light", viewport: { width: 1600, height: 900 } });

async function openAddAnMcpServer(page: Page): Promise<Locator> {
  await page.goto("/settings/mcp-servers");
  await page.getByRole("button", { name: "Add an MCP server" }).click();
  return page.getByRole("dialog");
}

function row(page: Page, name: string): Locator {
  return page.getByRole("row").filter({ hasText: name });
}

async function expectFakeServerTools(dialog: Locator): Promise<void> {
  const tools = dialog.getByRole("region", { name: "Tools it lists" });
  await expect(tools).toBeVisible(CONNECTING);
  for (const tool of FAKE_MCP_TOOLS)
    await expect(tools.getByText(tool, { exact: true })).toBeVisible();
}

test("the user adds an MCP server by the form, reviews it and turns it on", async ({ page }) => {
  const dialog = await openAddAnMcpServer(page);
  await dialog.getByRole("textbox", { name: "Name", exact: true }).fill("e2e-form-server");
  await dialog.getByLabel("Command").fill(process.execPath);
  await dialog.getByLabel("Arguments").fill(FAKE_MCP_SERVER);
  await dialog.getByRole("button", { name: "Add a Server value" }).click();
  const value = dialog.getByRole("group", { name: "the new Server value" });
  await value.getByLabel("Name").fill("FAKE_GREETING");
  await dialog
    .getByRole("group", { name: "the Server value FAKE_GREETING" })
    .getByLabel("Office-wide value")
    .fill("hello");
  await dialog.getByRole("button", { name: "Add to the library" }).click();

  await expect(page.getByRole("heading", { name: "Review e2e-form-server" })).toBeVisible();
  await expectFakeServerTools(dialog);
  await expect(dialog.getByText("hello (Plain, required)")).toBeVisible();
  await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-mcp-servers-review.png") });
  await dialog.getByRole("button", { name: "Turn it on" }).click();

  // Turning it on connects again to list the tools anew, as long as the review's connection.
  await expect(page.getByText("e2e-form-server is on. Assign it on a Role card.")).toBeVisible(
    CONNECTING,
  );
  await expect(row(page, "e2e-form-server")).toContainText("On");
  await expect(row(page, "e2e-form-server")).toContainText("1 Server value");
  await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-mcp-servers.png") });

  await row(page, "e2e-form-server").getByRole("button", { name: "Review" }).click();
  await expectFakeServerTools(dialog);
  await dialog.getByRole("button", { name: "Turn it off" }).click();
  await expect(row(page, "e2e-form-server")).toContainText("Off");
});

test(
  "a pasted JSON config fills the form for the user to check before adding",
  { tag: "@full" },
  async ({ page }) => {
    const dialog = await openAddAnMcpServer(page);
    await dialog.getByRole("tab", { name: "Paste a JSON config" }).click();
    await dialog.getByLabel("JSON config").fill(
      JSON.stringify({
        mcpServers: {
          "e2e-pasted-server": {
            command: process.execPath,
            args: [FAKE_MCP_SERVER],
            env: { FAKE_TOKEN: "pasted-token-value", FAKE_REGION: "${REGION:-eu}" },
          },
        },
      }),
    );
    await dialog.getByRole("button", { name: "Read the config" }).click();

    await expect(dialog.getByText("Read from the pasted config.")).toBeVisible();
    await expect(dialog.getByRole("textbox", { name: "Name", exact: true }).first()).toHaveValue(
      "e2e-pasted-server",
    );
    const token = dialog.getByRole("group", { name: "the Server value FAKE_TOKEN" });
    await expect(token.getByRole("checkbox").first()).toHaveAttribute("aria-checked", "true");
    const region = dialog.getByRole("group", { name: "the Server value FAKE_REGION" });
    await expect(region.getByLabel("Office-wide value")).toHaveValue("eu");
    // The user checks the flags: the region is optional.
    await region.getByText("Required", { exact: true }).click();
    await dialog.getByRole("button", { name: "Add to the library" }).click();

    await expect(page.getByRole("heading", { name: "Review e2e-pasted-server" })).toBeVisible();
    await expectFakeServerTools(dialog);
    await expect(dialog.getByText("Set (Secret, required)")).toBeVisible();
    await expect(dialog.getByText("eu (Plain, optional)")).toBeVisible();
    await expect(dialog).not.toContainText("pasted-token-value");
  },
);

test(
  "a secret Server value is never shown, not even in a failed review",
  { tag: "@full" },
  async ({ page }) => {
    const secret = "never-shown-token-value";
    const added = await page.request.post("/api/mcp-servers", {
      data: {
        name: "e2e-secret-server",
        transport: "stdio",
        command: process.execPath,
        // The fake server fails, writing its token to its standard error.
        arguments: [FAKE_MCP_SERVER, "--fail"],
        serverValues: [
          { name: "FAKE_TOKEN", secret: true, required: true, officeWideValue: secret },
        ],
      },
    });
    expect(added.status()).toBe(201);
    expect(await added.text()).not.toContain(secret);
    expect(await (await page.request.get("/api/mcp-servers")).text()).not.toContain(secret);

    await page.goto("/settings/mcp-servers");
    await row(page, "e2e-secret-server").getByRole("button", { name: "Review" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("It couldn't connect")).toBeVisible(CONNECTING);
    await expect(dialog.getByText("The fake server was told to fail")).toBeVisible();
    await expect(dialog).not.toContainText(secret);
    await expect(dialog.getByRole("button", { name: "Turn it on" })).toBeDisabled();

    await dialog.getByRole("button", { name: "Edit" }).click();
    await expect(page.getByRole("heading", { name: "Edit e2e-secret-server" })).toBeVisible();
    const token = dialog.getByRole("group", { name: "the Server value FAKE_TOKEN" });
    await expect(token.getByLabel("Office-wide value")).toHaveValue("");
    await expect(
      token.getByText("A value is set. It is never shown; type a new one to replace it."),
    ).toBeVisible();
    await expect(page.locator("body")).not.toContainText(secret);
  },
);
