import { expect, test } from "@playwright/test";
import {
  gitHubAppManifestFormSchema,
  gitHubStateSchema,
  OFFICE_IDENTITY_SETTINGS_PATH,
  officeSshKeySchema,
} from "@the-office/contracts";
import { FAKE_GITHUB_URL } from "./fake-github.ts";

test("registering the GitHub App goes to the fake GitHub server and back to The Office", async ({
  page,
}) => {
  const manifest = await page.request.get("/api/github/app/manifest");
  const form = gitHubAppManifestFormSchema.parse(await manifest.json());
  expect(new URL(form.action).origin).toBe(FAKE_GITHUB_URL);

  // As the browser posts the form: the fake registers the App and sends it back to The Office.
  const landed = await page.request.post(form.action, { form: { manifest: form.manifest } });

  const landedOn = new URL(landed.url());
  expect(landedOn.pathname).toBe(OFFICE_IDENTITY_SETTINGS_PATH);
  expect(landedOn.search).toBe("");
  const state = gitHubStateSchema.parse(await (await page.request.get("/api/github")).json());
  expect(state).toMatchObject({ status: "signed-out", app: { owner: "office-user" } });
});

test("the Office ssh key's public half is shown, never its private half", async ({ page }) => {
  const sshKey = await page.request.get("/api/office-identity/ssh-key");

  const { publicKey } = officeSshKeySchema.parse(await sshKey.json());
  expect(publicKey).toMatch(/^ssh-ed25519 \S+ the-office@/);
  expect(publicKey).not.toContain("PRIVATE KEY");
});
