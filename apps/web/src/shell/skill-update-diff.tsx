import { useQuery } from "@tanstack/react-query";
import type {
  PinnedVersion,
  SkillUpdateDiff as SkillUpdateDiffResponse,
} from "@the-office/contracts";
import type { ReactNode } from "react";
import { skillQueries } from "../api/skills.ts";
import { RefusalAlert } from "./refusal-alert.tsx";
import { pinnedVersionLabel } from "./skill-words.ts";
import { UnifiedDiffView } from "./unified-diff-view.tsx";
import "./skill-update-diff.css";

type SkillDiff = Pick<SkillUpdateDiffResponse, "diff" | "diffCut">;

/**
 * What an installed skill's update changes in its files: on the update's card and in "Review the
 * update" (spec §2.6). Read from its Source, unless the applied update kept it (`appliedDiff`), so
 * the card still shows it once the Source is gone or no longer has those versions.
 */
export function SkillUpdateDiff({
  name,
  from,
  to,
  appliedDiff,
}: {
  readonly name: string;
  readonly from: PinnedVersion;
  readonly to: PinnedVersion;
  readonly appliedDiff?: SkillDiff | null;
}): ReactNode {
  const read = useQuery({ ...skillQueries.updateDiff(name, from, to), enabled: !appliedDiff });
  const label = `Changes from ${pinnedVersionLabel(from)} to ${pinnedVersionLabel(to)}`;
  if (appliedDiff) return <SkillDiffView diff={appliedDiff} label={label} />;
  if (read.error) return <RefusalAlert title="The changes can't be read" error={read.error} />;
  if (!read.data) {
    return <p className="skill-update-diff-note">Reading the changes from the source…</p>;
  }
  return <SkillDiffView diff={read.data} label={label} />;
}

function SkillDiffView({
  diff,
  label,
}: {
  readonly diff: SkillDiff;
  readonly label: string;
}): ReactNode {
  if (diff.diff === "") {
    return <p className="skill-update-diff-note">The skill&apos;s files are the same in both.</p>;
  }
  return (
    <>
      <UnifiedDiffView diff={diff.diff} label={label} />
      {diff.diffCut && (
        <p className="skill-update-diff-note">The diff stops here: the rest is too long to show.</p>
      )}
    </>
  );
}
