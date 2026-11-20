import type { ReactNode } from "react";
import { usePageHeading } from "../../../shell/page-heading.tsx";
import { GoogleClientCard } from "./google-client-card.tsx";
import { OpenIdConnectProviderCard } from "./openid-connect-provider-card.tsx";
import "./signing-in.css";

/**
 * Settings › Signing in (spec §2.10): what the ways to sign in need of The Office, one for every
 * user: the Google OAuth client and the OpenID Connect provider Continue with them sign in through.
 */
export function SigningInSection(): ReactNode {
  usePageHeading({ title: "Settings", crumb: "Signing in" });
  return (
    <>
      <p className="settings-note">
        Each user signs in with a password, a passkey, or Continue with GitHub, Google or your own
        OpenID Connect provider once they have linked that account from their own Account page.
        Continue with GitHub is set up with the GitHub App in Office identity.
      </p>
      <GoogleClientCard />
      <OpenIdConnectProviderCard />
    </>
  );
}
