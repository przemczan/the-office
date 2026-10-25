import { useQuery } from "@tanstack/react-query";
import type { Role, Skill } from "@the-office/contracts";
import { Alert, Badge, Button, Card, DataTable, Icon, type DataTableColumn } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { roleQueries } from "../../../api/people.ts";
import { skillQueries } from "../../../api/skills.ts";
import { usePageHeading } from "../../../shell/page-heading.tsx";
import { SkillChip } from "../../../shell/skill-chip.tsx";
import { AddSkillDialog } from "./add-skill-dialog.tsx";
import { EditSkillDialog } from "./edit-skill-dialog.tsx";
import { ReviewSkillDialog } from "./review-skill-dialog.tsx";
import {
  holdersLabel,
  inReviewOrder,
  SOURCE_LABELS,
  STATE_BADGES,
  waitingLine,
} from "./skill-labels.ts";
import { UploadVersionDialog } from "./upload-version-dialog.tsx";
import { WhoHasItDialog } from "./who-has-it-dialog.tsx";

/** Which dialog is open over the library, and for which skill. */
export type SkillDialog =
  | { readonly kind: "add" }
  | { readonly kind: "review" | "edit" | "upload-version" | "who-has-it"; readonly name: string };

/** Settings › Skills: the library, what waits for review, and adding a skill. */
export function SkillsSection(): ReactNode {
  usePageHeading({ title: "Settings", crumb: "Skills" });
  const skills = useQuery(skillQueries.list());
  const roles = useQuery(roleQueries.list());
  const [dialog, setDialog] = useState<SkillDialog>();
  const close = (): void => setDialog(undefined);
  const library = inReviewOrder(skills.data ?? []);
  const waiting = waitingLine(library);
  return (
    <>
      <Card
        title={
          <span className="settings-block-title">
            <Icon name="sparkles" size={15} strokeWidth={1.6} />
            The skill library <span className="settings-count">{library.length}</span>
          </span>
        }
        actions={
          <Button
            size="sm"
            iconLeft={<Icon name="plus" size={14} />}
            onClick={() => setDialog({ kind: "add" })}
          >
            Add a skill
          </Button>
        }
      >
        <p className="settings-note">
          One folder holds every skill once. A session gets its Role&apos;s skills, the skills for
          everyone, and the Project&apos;s own skills when the Project allows them, and nothing
          else. Until a skill is used only its name and description sit in the context.
        </p>
        {waiting && (
          <div className="settings-banner">
            <Alert tone="info">{waiting}</Alert>
          </div>
        )}
        {skills.error && (
          <div className="settings-banner">
            <Alert tone="danger" title="The library can't be read">
              {skills.error.message}
            </Alert>
          </div>
        )}
      </Card>
      <Card padding="none">
        <DataTable
          rowKey="name"
          density="relaxed"
          rows={library}
          columns={columns(setDialog, roles.data ?? [])}
          loading={skills.isPending}
          empty="The library is empty. Add a skill by uploading it or writing it here."
        />
      </Card>
      {dialog?.kind === "add" && <AddSkillDialog onClose={close} onOpen={setDialog} />}
      {dialog?.kind === "review" && (
        <ReviewSkillDialog name={dialog.name} onClose={close} onOpen={setDialog} />
      )}
      {dialog?.kind === "edit" && (
        <EditSkillDialog name={dialog.name} onClose={close} onOpen={setDialog} />
      )}
      {dialog?.kind === "upload-version" && (
        <UploadVersionDialog name={dialog.name} onClose={close} onOpen={setDialog} />
      )}
      {dialog?.kind === "who-has-it" && <WhoHasItDialog name={dialog.name} onClose={close} />}
    </>
  );
}

function columns(
  open: (dialog: SkillDialog) => void,
  roles: readonly Role[],
): DataTableColumn<Skill>[] {
  return [
    {
      key: "name",
      header: "Skill",
      wrap: true,
      render: (skill) => (
        <>
          <SkillChip name={skill.name} />
          <div className="skill-description">{skill.description}</div>
        </>
      ),
    },
    {
      key: "source",
      header: "Source",
      render: (skill) => (
        <>
          <div className="skill-source">{SOURCE_LABELS[skill.source]}</div>
          <div className="skill-version">v{skill.version}</div>
        </>
      ),
    },
    {
      key: "everyone",
      header: "Who has it",
      render: (skill) => <span className="skill-holders">{holdersLabel(skill, roles)}</span>,
    },
    {
      key: "state",
      header: "State",
      render: (skill) => (
        <Badge tone={STATE_BADGES[skill.state].tone} dot>
          {STATE_BADGES[skill.state].label}
        </Badge>
      ),
    },
    {
      key: "actions",
      header: <span className="visually-hidden">Actions</span>,
      align: "right",
      render: (skill) => (
        <div className="skill-actions">
          <Button
            size="sm"
            variant={skill.state === "waiting-for-review" ? "primary" : "ghost"}
            onClick={() => open({ kind: "review", name: skill.name })}
          >
            Review
          </Button>
          {skill.state !== "waiting-for-review" && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => open({ kind: "who-has-it", name: skill.name })}
            >
              Assign…
            </Button>
          )}
        </div>
      ),
    },
  ];
}
