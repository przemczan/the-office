import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReviewedFile, SkillReview } from "@the-office/contracts";
import { Alert, Button, Dialog, Icon } from "@the-office/ui";
import type { ReactNode } from "react";
import { changeSkillState, removeSkill, skillQueries } from "../../../api/skills.ts";
import { RefusalAlert } from "../../../shell/refusal-alert.tsx";
import { useToast } from "../../../shell/toasts.tsx";
import { useSkillSaved } from "./skill-fields.tsx";
import { SOURCE_LABELS } from "./skill-labels.ts";
import type { SkillDialog } from "./skills-section.tsx";

/**
 * Review: the skill's files as sessions would get them, with what they change in a session.
 * Turning it on is one click (spec §9); a new version comes back here.
 */
export function ReviewSkillDialog({
  name,
  onClose,
  onOpen,
}: {
  readonly name: string;
  readonly onClose: () => void;
  readonly onOpen: (dialog: SkillDialog) => void;
}): ReactNode {
  const review = useQuery(skillQueries.review(name));
  const queryClient = useQueryClient();
  const saved = useSkillSaved();
  const showToast = useToast();
  const switching = useMutation({
    mutationFn: (state: "on" | "off") => changeSkillState(name, state),
    onSuccess: async (skill) => {
      await saved(skill);
      if (skill.state === "on") {
        showToast(`${skill.name} is on. Choose who has it.`);
        onOpen({ kind: "who-has-it", name: skill.name });
      } else {
        showToast(`${skill.name} is off. Sessions started from now on don't get it.`);
        onClose();
      }
    },
  });
  const removing = useMutation({
    mutationFn: () => removeSkill(name),
    onSuccess: async () => {
      await queryClient.invalidateQueries(skillQueries.list());
      showToast(`${name} removed from the library.`);
      onClose();
    },
  });
  const skill = review.data?.skill;
  const failure = switching.error ?? removing.error ?? review.error;
  return (
    <Dialog
      title={`Review ${name}`}
      width={720}
      onClose={onClose}
      actions={
        <>
          <Button
            variant="danger-ghost"
            iconLeft={<Icon name="trash-2" size={14} />}
            loading={removing.isPending}
            onClick={() => removing.mutate()}
          >
            Remove it
          </Button>
          {skill && (
            <Button
              variant="ghost"
              onClick={() =>
                onOpen({
                  kind: skill.source === "written" ? "edit" : "upload-version",
                  name,
                })
              }
            >
              {skill.source === "written" ? "Edit" : "Upload a new version"}
            </Button>
          )}
          <span className="skill-dialog-spacer" />
          <Button variant="secondary" onClick={onClose}>
            Later
          </Button>
          {skill && (
            <Button
              variant={skill.state === "on" ? "secondary" : "primary"}
              loading={switching.isPending}
              onClick={() => switching.mutate(skill.state === "on" ? "off" : "on")}
            >
              {skill.state === "on" ? "Turn it off" : "Turn it on"}
            </Button>
          )}
        </>
      }
    >
      {failure && <RefusalAlert title="That didn't work" error={failure} />}
      {review.data && <Review review={review.data} />}
    </Dialog>
  );
}

function Review({ review }: { readonly review: SkillReview }): ReactNode {
  const { skill, files, warnings } = review;
  return (
    <div className="skill-review">
      <p className="skill-review-summary">
        {skill.description}{" "}
        <span>
          · {SOURCE_LABELS[skill.source]} · v{skill.version}
        </span>
      </p>
      {warnings.length > 0 && (
        <Alert tone="warning">
          <ul className="skill-warnings">
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </Alert>
      )}
      {files.map((file) => (
        <FileView key={file.path} file={file} />
      ))}
    </div>
  );
}

function FileView({ file }: { readonly file: ReviewedFile }): ReactNode {
  return (
    <div className="file-view">
      <div className="file-view-head">
        <Icon name={file.script ? "terminal" : "file-text"} size={13} strokeWidth={1.6} />
        {file.path}
      </div>
      {file.text === undefined ? (
        <p className="file-view-binary">Not text, so not shown.</p>
      ) : (
        <pre>{file.text}</pre>
      )}
    </div>
  );
}
