import { useQuery } from "@tanstack/react-query";
import type { PinnedVersion } from "@the-office/contracts";
import type { ReactNode } from "react";
import { skillQueries } from "../api/skills.ts";
import { RefusalAlert } from "./refusal-alert.tsx";
import { pinnedVersionLabel } from "./skill-words.ts";
import { UnifiedDiffView } from "./unified-diff-view.tsx";
import "./skill-update-diff.css";

/**
 * What an installed skill's update changes in its files, read from its Source: on the update's
 * card and in "Review the update" (spec §2.6).
 */
export function SkillUpdateDiff({
  name,
  from,
  to,
}: {
  readonly name: string;
  readonly from: PinnedVersion;
  readonly to: PinnedVersion;
}): ReactNode {
  const diff = useQuery(skillQueries.updateDiff(name, from, to));
  if (diff.error) return <RefusalAlert title="The changes can't be read" error={diff.error} />;
  if (!diff.data)
    return <p className="skill-update-diff-note">Reading the changes from the source…</p>;
  if (diff.data.diff === "") {
    return <p className="skill-update-diff-note">The skill&apos;s files are the same in both.</p>;
  }
  return (
    <>
      <UnifiedDiffView
        diff={diff.data.diff}
        label={`Changes from ${pinnedVersionLabel(from)} to ${pinnedVersionLabel(to)}`}
      />
      {diff.data.diffCut && (
        <p className="skill-update-diff-note">The diff stops here: the rest is too long to show.</p>
      )}
    </>
  );
}
