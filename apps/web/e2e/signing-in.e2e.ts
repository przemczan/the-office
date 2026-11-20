import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test } from "@playwright/test";
import { NOT_SIGNED_IN } from "./e2e-user.ts";
import { screenshotScenario } from "./task-screenshots.ts";

const CLIENT_ID = "1234-e2e.apps.googleusercontent.com";

// The Google OAuth client and the OpenID Connect provider are one per Office: this file alone saves
// them, and removes them after, so the sign-in page other files open offers them only meanwhile.
test.afterEach(async ({ request }) => {
  await request.delete("/api/settings/google-client");
  await request.delete("/api/settings/openid-connect-provider");
});

test("a Google OAuth client saved in Settings › Signing in offers Continue with Google, sending Google its client id, redirect URI, PKCE and scopes, until it is removed", async ({
  page,
  browser,
}, testInfo) => {
  await page.goto("/settings/signing-in");
  const card = page.getByRole("form", { name: "Google OAuth client" });
  await card.getByLabel("Client ID").fill(CLIENT_ID);
  await card.getByLabel("Client secret").fill("GOCSPX-e2e-secret");
  await card.getByRole("button", { name: "Save" }).click();
  await expect(card.getByText("Secret set")).toBeVisible();
  await expect(card.getByLabel("Client secret")).toHaveValue("");
  const redirectUri = `${testInfo.project.use.baseURL}/api/sign-in/google/callback`;
  await expect(page.getByRole("region", { name: "Redirect URIs", exact: true })).toContainText(
    redirectUri,
  );
  await screenshotScenario(page, "settings-signing-in", { fullPage: true });

  // Each user links their Google account from their own account, now that a client is saved.
  await page.goto("/account/linked-identities");
  await expect(page.getByRole("button", { name: "Link Google" })).toBeEnabled();
  await screenshotScenario(page, "account-linked-identities-google");
  await page.goto("/settings/signing-in");

  const fresh = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
    storageState: NOT_SIGNED_IN,
  });
  try {
    const signingIn = await fresh.newPage();
    // Google itself is never reached: its authorize page is caught and read.
    const authorizeUrl = new Promise<URL>((resolve) => {
      void signingIn.route("https://accounts.google.com/**", async (route) => {
        resolve(new URL(route.request().url()));
        await route.fulfill({ status: 200, contentType: "text/html", body: "Google" });
      });
    });
    await signingIn.goto("/sign-in");
    await screenshotScenario(signingIn, "sign-in-continue-with-google");
    await signingIn.getByRole("button", { name: "Continue with Google" }).click();

    const sent = (await authorizeUrl).searchParams;
    expect(sent.get("client_id")).toBe(CLIENT_ID);
    expect(sent.get("redirect_uri")).toBe(redirectUri);
    expect(sent.get("code_challenge_method")).toBe("S256");
    expect(sent.get("code_challenge")).toMatch(/^[\w-]{43}$/);
    expect(sent.get("scope")).toBe("openid email");
    expect(sent.get("access_type")).toBeNull();

    await card.getByRole("button", { name: "Remove", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Remove the client" }).click();
    await expect(card.getByText("Continue with Google isn't offered")).toBeVisible();

    await signingIn.goto("/sign-in");
    await expect(signingIn.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
    await expect(signingIn.getByRole("button", { name: "Continue with Google" })).toBeHidden();
  } finally {
    await fresh.close();
  }
});

test(
  "an OpenID Connect provider saved in Settings › Signing in offers Continue with its name on the sign-in page, until it is removed",
  { tag: "@full" },
  async ({ page, browser }, testInfo) => {
    // The provider's issuer is a tiny server on this machine, whose discovery document names itself.
    const issuerServer = createServer((request, response) => {
      const issuer = `http://127.0.0.1:${(issuerServer.address() as AddressInfo).port}`;
      if (request.url === "/.well-known/openid-configuration") {
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            issuer,
            authorization_endpoint: `${issuer}/authorize`,
            token_endpoint: `${issuer}/token`,
          }),
        );
        return;
      }
      response.statusCode = 404;
      response.end();
    });
    await new Promise<void>((resolve) => issuerServer.listen(0, "127.0.0.1", resolve));
    const issuer = `http://127.0.0.1:${(issuerServer.address() as AddressInfo).port}`;
    const fresh = await browser.newContext({
      baseURL: testInfo.project.use.baseURL,
      storageState: NOT_SIGNED_IN,
    });
    try {
      await page.goto("/settings/signing-in");
      const card = page.getByRole("form", { name: "OpenID Connect provider" });
      await card.getByLabel("Name").fill("Zitadel");
      await card.getByLabel("Issuer URL").fill(issuer);
      await card.getByLabel("Client ID").fill("e2e-client");
      await card.getByLabel("Client secret").fill("e2e-oidc-secret");
      await card.getByRole("button", { name: "Save" }).click();
      await expect(card.getByText("Secret set")).toBeVisible();
      await expect(card.getByLabel("Client secret")).toHaveValue("");
      await expect(
        page.getByRole("region", { name: "Redirect URIs at the provider" }),
      ).toContainText("/api/sign-in/openid-connect/callback");
      await screenshotScenario(page, "settings-signing-in-openid-connect", { fullPage: true });

      const signingIn = await fresh.newPage();
      await signingIn.goto("/sign-in");
      await expect(signingIn.getByRole("button", { name: "Continue with Zitadel" })).toBeVisible();
      await screenshotScenario(signingIn, "sign-in-continue-with-openid-connect");

      await card.getByRole("button", { name: "Remove", exact: true }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Remove the provider" }).click();
      await expect(
        card.getByText("Continue with an OpenID Connect provider isn't offered"),
      ).toBeVisible();
      await signingIn.goto("/sign-in");
      await expect(signingIn.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
      await expect(signingIn.getByRole("button", { name: "Continue with Zitadel" })).toBeHidden();
    } finally {
      await fresh.close();
      await new Promise((resolve) => issuerServer.close(resolve));
    }
  },
);
