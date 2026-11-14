import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { PinnedVersion, Proposal, ProposedChange, Skill } from "@the-office/contracts";
import { Alert, Button, Dialog, Icon } from "@the-office/ui";
import type { ReactNode } from "react";
import { applyProposal, proposalQueries } from "../../../api/conversations.ts";
import { roleQueries } from "../../../api/people.ts";
import { skillQueries } from "../../../api/skills.ts";
import { useAskDevops } from "../../../shell/ask-devops.tsx";
import { roleName } from "../../../shell/person-name.ts";
import { RefusalAlert } from "../../../shell/refusal-alert.tsx";
import { SkillUpdateDiff } from "../../../shell/skill-update-diff.tsx";
import { pinnedVersionLabel, samePinnedVersion } from "../../../shell/skill-words.ts";
import { useToast } from "../../../shell/toasts.tsx";

type ProposedSkillUpdate = Extract<ProposedChange, { kind: "skill-update" }>;

/**
 * "Review the update" (spec §2.6): Devops' open update Proposal for the skill, with its notes and
 * the files' diff, applied here as on its card; or, before Devops drafted one, asking them to.
 */
export function UpdateSkillDialog({
  name,
  onClose,
}: {
  readonly name: string;
  readonly onClose: () => void;
}): ReactNode {
  const skills = useQuery(skillQueries.list());
  const open = useQuery(proposalQueries.open());
  const roles = useQuery(roleQueries.list());
  const devops = useAskDevops(onClose);
  const queryClient = useQueryClient();
  const showToast = useToast();
  const skill = skills.data?.find((candidate) => candidate.name === name);
  const pinned = skill?.installedFrom?.pinnedVersion;
  // One proposed from another pinned version is stale and would be refused, so it isn't offered.
  const proposal = open.data?.find(
    (candidate): candidate is Proposal & { change: ProposedSkillUpdate } =>
      candidate.change.kind === "skill-update" &&
      candidate.change.name === name &&
      pinned !== undefined &&
      samePinnedVersion(candidate.change.from, pinned),
  );
  const applying = useMutation({
    mutationFn: (id: string) => applyProposal(id, {}),
    onSuccess: async (applied) => {
      await Promise.all([
        queryClient.invalidateQueries(skillQueries.list()),
        queryClient.invalidateQueries({ queryKey: ["proposals"] }),
      ]);
      if (applied.change.kind === "skill-update") {
        showToast(`${name} pinned at ${pinnedVersionLabel(applied.change.to)}.`);
      }
      onClose();
    },
  });
  const failure = applying.error ?? devops.error ?? open.error ?? skills.error;
  const installedFrom = skill?.installedFrom;
  const to = proposal?.change.to ?? skill?.update;
  return (
    <Dialog
      size="large"
      title={`Update ${name}?`}
      onClose={onClose}
      actions={
        proposal ? (
          <Button loading={applying.isPending} onClick={() => applying.mutate(proposal.id)}>
            Apply the update
          </Button>
        ) : (
          devops.person &&
          to && (
            <Button loading={devops.asking} onClick={() => devops.ask(updateDraft(name, to))}>
              Ask {devops.person.card.name} to propose it
            </Button>
          )
        )
      }
    >
      <div className="dialog-stack">
        {failure && <RefusalAlert title="That didn't work" error={failure} />}
        {skill && installedFrom && to && (
          <div className="skill-review">
            <p className="skill-update-versions">
              Version {pinnedVersionLabel(proposal?.change.from ?? installedFrom.pinnedVersion)}{" "}
              <Icon name="arrow-right" size={13} aria-label="to" /> {pinnedVersionLabel(to)}
            </p>
            {proposal ? (
              <ProposedUpdate
                proposal={proposal}
                drafter={roleName(proposal.draftedBy, roles.data)}
                skill={skill}
              />
            ) : (
              <NoProposalYet devopsName={devops.person?.card.name} to={to} />
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}

function ProposedUpdate({
  proposal,
  drafter,
  skill,
}: {
  readonly proposal: Proposal & { change: ProposedSkillUpdate };
  readonly drafter: string;
  readonly skill: Skill;
}): ReactNode {
  const { change } = proposal;
  return (
    <>
      <p className="skill-update-notes">{change.notes}</p>
      <p className="skill-review-summary">
        <span>
          Proposed by {drafter}. Applying it is your review, so {skill.name} stays{" "}
          {skill.state === "on" ? "on" : "off"}; running sessions keep the version they started
          with.
        </span>
      </p>
      <SkillUpdateDiff name={change.name} from={change.from} to={change.to} />
    </>
  );
}

function NoProposalYet({
  devopsName,
  to,
}: {
  readonly devopsName: string | undefined;
  readonly to: PinnedVersion;
}): ReactNode {
  if (!devopsName) {
    return (
      <Alert tone="info" title="Updating needs whoever holds Onboards and repairs Projects">
        They propose the update with notes on what changes, and you apply it. Choose who in Settings
        › Duties, or <Link to="/people">hire someone on the People page.</Link>
      </Alert>
    );
  }
  return (
    <p className="skill-review-summary">
      <span>
        Its source has {pinnedVersionLabel(to)}. {devopsName} proposes the update with notes on what
        changes and its files&apos; diff, and you apply it here or on the card in their chat.
      </span>
    </p>
  );
}

/** What waits in Devops' composer: the skill and the version, for the user to send or add to. */
function updateDraft(name: string, to: PinnedVersion): string {
  return `Can you propose the update of ${name} to ${pinnedVersionLabel(to)}?`;
}
