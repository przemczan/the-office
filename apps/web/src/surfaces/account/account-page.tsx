import { Outlet } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { SectionLayout, type MenuSection } from "../../shell/section-layout.tsx";
import "./account.css";

/** The account's sections, each a page of its own; later Tasks add theirs here. */
const SECTIONS: readonly MenuSection[] = [
  { to: "/account/profile", icon: "user-round", label: "Profile" },
  { to: "/account/appearance", icon: "palette", label: "Appearance" },
  { to: "/account/passkeys", icon: "key-round", label: "Passkeys" },
  { to: "/account/linked-identities", icon: "link", label: "Linked identities" },
  { to: "/account/signed-in-devices", icon: "monitor-smartphone", label: "Signed-in devices" },
];

/**
 * The signed-in user's account (spec §2.10): their own profile, password, appearance, passkeys,
 * linked identities and signed-in devices, each a section beside the open one.
 */
export function AccountPage(): ReactNode {
  return (
    <div className="account-page">
      <SectionLayout label="Account" sections={SECTIONS}>
        <Outlet />
      </SectionLayout>
    </div>
  );
}
