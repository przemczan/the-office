import { useAppearance } from "@the-office/ui";
import type { ReactNode } from "react";
import { OfficeMark } from "../../shell/office-mark.tsx";

/** The Office's mark and name above the sign-in pages. */
export function OfficeName(): ReactNode {
  const { base } = useAppearance();
  return (
    <div className="sign-in-office">
      <OfficeMark size={28} tone={base} />
      <span>The Office</span>
    </div>
  );
}
