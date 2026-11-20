import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  OFFICE_IDENTITY_SETTINGS_PATH,
  type IssueSettings,
  type Project,
} from "@the-office/contracts";
import { Button, EmptyState, Icon, Input, Switch } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { changeIssueSettings, projectQueries } from "../../../api/projects.ts";
import { GitHubPermissionsPrompt } from "../../../shell/github-permissions-prompt.tsx";
import { RefusalAlert } from "../../../shell/refusal-alert.tsx";
import { useToast } from "../../../shell/toasts.tsx";
import { ProjectBlock } from "../project-block.tsx";
import { ImportIssuesDialog } from "../../../shell/issues/import-issues-dialog.tsx";
import {
  issuesRefusalOf,
  notImportedWords,
  repositoryOfIssue,
  SIGN_IN_TO_IMPORT,
} from "../../../shell/issues/issue-words.ts";

/** The three write-back switches, in the block's order, with their words. */
const WRITE_BACKS: readonly {
  readonly key: "closeOnDone" | "commentOnStartAndDone" | "closeOnDrop";
  readonly name: string;
  readonly line: string;
}[] = [
  {
    key: "closeOnDone",
    name: "Close the issue when the Task is Done",
    line: 'Puts "Fixes #n" in the commit message and the pull request. GitHub closes the issue when the change reaches the default branch.',
  },
  {
    key: "commentOnStartAndDone",
    name: "Comment when the Task starts and when it is Done",
    line: "The Done comment links the pull request, or names the commit when publishing merges.",
  },
  {
    key: "closeOnDrop",
    name: "Close the issue when the Task is Dropped",
    line: "Closes it as not planned, with a comment giving the Drop reason.",
  },
];

/**
 * The GitHub issues section (docs/design/issues-as-tasks.html): Import issues…, the repository and
 * its open issues not yet imported, the auto-import label and the write-back switches, each saved
 * at once. A repository not on GitHub shows why in place of all of it; signed out, the switches
 * can still be set.
 */
export function GitHubIssuesBlock({ project }: { readonly project: Project }): ReactNode {
  const issues = useQuery({ ...projectQueries.openIssues(project.id), retry: false });
  const [importing, setImporting] = useState(false);
  const refusal = issues.error ? issuesRefusalOf(issues.error) : undefined;
  if (refusal?.kind === "not-on-github") {
    return (
      <ProjectBlock icon="circle-dot" title="GitHub issues">
        <EmptyState icon="github" title={refusal.words} compact />
      </ProjectBlock>
    );
  }
  const repository = repositoryOfIssue(issues.data?.[0]?.url ?? "");
  return (
    <ProjectBlock
      icon="circle-dot"
      title="GitHub issues"
      actions={
        <Button
          variant="secondary"
          size="sm"
          iconLeft={<Icon name="github" size={13} />}
          onClick={() => setImporting(true)}
        >
          Import issues…
        </Button>
      }
    >
      <GitHubPermissionsPrompt needing="issues" />
      <div className="project-setting">
        <div className="project-setting-words">
          <span className="project-setting-name">Repository</span>
          <span className="project-setting-line">
            {issues.data
              ? [repository, notImportedWords(issues.data.length)].filter(Boolean).join(" · ")
              : refusal
                ? "Its issues can't be read now."
                : "Reading its open issues…"}
          </span>
        </div>
        <div className="project-setting-control inline">
          {refusal?.kind === "sign-in" ? (
            <span className="project-setting-line">
              {SIGN_IN_TO_IMPORT}{" "}
              <Link to={OFFICE_IDENTITY_SETTINGS_PATH}>Settings › Office identity</Link>
            </span>
          ) : issues.data ? (
            <span className="project-setting-line">Signed in with GitHub</span>
          ) : null}
        </div>
      </div>
      {refusal?.kind === "failed" && (
        <RefusalAlert title="The open issues can't be read" error={refusal.error} />
      )}
      <IssueSwitches project={project} />
      {importing && (
        <ImportIssuesDialog
          projects={[project]}
          projectId={project.id}
          onClose={() => setImporting(false)}
        />
      )}
    </ProjectBlock>
  );
}

/** The auto-import label and the write-back switches, each change saving the whole settings. */
function IssueSwitches({ project }: { readonly project: Project }): ReactNode {
  const settings = project.issueSettings;
  const queryClient = useQueryClient();
  const showToast = useToast();
  // Turned off, the label stays here for the next time it is turned on.
  const [label, setLabel] = useState(settings.autoImportLabel ?? "");
  const [nameItFirst, setNameItFirst] = useState(false);
  const saving = useMutation({
    scope: { id: `issue-settings-${project.id}` },
    mutationFn: (change: Partial<IssueSettings>) =>
      changeIssueSettings(project.id, { ...settings, ...change }),
    onSuccess: (saved, change) => {
      queryClient.setQueryData(projectQueries.one(saved.id).queryKey, saved);
      if ("autoImportLabel" in change) {
        showToast(
          saved.issueSettings.autoImportLabel === null
            ? `${saved.name} no longer imports issues by label.`
            : `Open issues labelled ${saved.issueSettings.autoImportLabel} become Tasks in ${saved.name}.`,
        );
      }
    },
  });
  const autoImportOn = settings.autoImportLabel !== null;
  const turnAutoImport = (on: boolean): void => {
    if (!on) {
      setNameItFirst(false);
      saving.mutate({ autoImportLabel: null });
      return;
    }
    const named = label.trim();
    if (named === "") {
      setNameItFirst(true);
      return;
    }
    setNameItFirst(false);
    saving.mutate({ autoImportLabel: named });
  };
  const keepLabel = (): void => {
    const named = label.trim();
    if (autoImportOn && named !== "" && named !== settings.autoImportLabel) {
      saving.mutate({ autoImportLabel: named });
    }
  };
  return (
    <>
      <div className="project-setting" role="group" aria-label="Auto-import issues with a label">
        <div className="project-setting-words">
          <span className="project-setting-name">Auto-import issues with a label</span>
          <span className="project-setting-line">
            Open issues with this label become Tasks in Backlog. Checked every 5 minutes while The
            Office is signed in with GitHub.
          </span>
        </div>
        <div className="project-setting-control inline">
          <div className="issue-label-input">
            <Input
              size="sm"
              aria-label="Label"
              placeholder="Label"
              maxLength={50}
              iconLeft={<Icon name="tag" size={13} />}
              value={label}
              onChange={(event) => {
                setLabel(event.target.value);
                setNameItFirst(false);
              }}
              onBlur={keepLabel}
              onKeyDown={(event) => {
                if (event.key === "Enter") keepLabel();
              }}
            />
          </div>
          <Switch checked={autoImportOn} disabled={saving.isPending} onChange={turnAutoImport} />
        </div>
      </div>
      {nameItFirst && (
        <p className="project-block-error" role="alert">
          Name the label first.
        </p>
      )}
      <h4 className="project-group-label">Write back to GitHub</h4>
      {WRITE_BACKS.map(({ key, name, line }) => (
        <div key={key} className="project-setting" role="group" aria-label={name}>
          <div className="project-setting-words">
            <span className="project-setting-name">{name}</span>
            <span className="project-setting-line">{line}</span>
          </div>
          <div className="project-setting-control inline">
            <Switch
              checked={settings[key]}
              disabled={saving.isPending}
              onChange={(on) => saving.mutate({ [key]: on })}
            />
          </div>
        </div>
      ))}
      {saving.error && (
        <p className="project-block-error" role="alert">
          {saving.error.message}
        </p>
      )}
    </>
  );
}
