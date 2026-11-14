import { Link } from "@tanstack/react-router";
import type { DutyKey } from "@the-office/contracts";
import type { ReactNode } from "react";
import { dutyUnheldWords, useDutyHolder } from "./use-duty-holder.ts";

/**
 * Where a button or tab named for a duty stands while nobody holds it: the duty's fallback, and
 * where to choose a holder (spec §4, "Duties on screen"). Nothing while someone holds it, or until
 * the duties are read.
 */
export function DutyUnheldNote({ duty }: { readonly duty: DutyKey }): ReactNode {
  const { label, fallback } = useDutyHolder(duty);
  if (fallback === undefined) return null;
  return (
    <p className="duty-unheld-note">
      {dutyUnheldWords(label, fallback)} Choose who in{" "}
      <Link to="/settings/duties">Settings › Duties</Link>.
    </p>
  );
}
