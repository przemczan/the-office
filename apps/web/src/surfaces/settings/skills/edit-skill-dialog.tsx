import { useMutation, useQuery } from "@tanstack/react-query";
import type { WrittenSkill } from "@the-office/contracts";
import { Button, Dialog } from "@the-office/ui";
import { useId, useState, type ReactNode } from "react";
import { editSkill, skillQueries } from "../../../api/skills.ts";
import { RefusalAlert } from "../../../shell/refusal-alert.tsx";
import { useToast } from "../../../shell/toasts.tsx";
import { SkillFields, useSkillSaved } from "./skill-fields.tsx";
import type { SkillDialog } from "./skills-section.tsx";

/** Edit for a written skill: the Write form, filled in; saving makes its next version. */
export function EditSkillDialog({
  name,
  onClose,
  onOpen,
}: {
  readonly name: string;
  readonly onClose: () => void;
  readonly onOpen: (dialog: SkillDialog) => void;
}): ReactNode {
  const review = useQuery(skillQueries.review(name));
  if (!review.data) return null;
  return (
    <EditForm
      start={{
        name,
        description: review.data.skill.description,
        instructions: review.data.instructions,
      }}
      onClose={onClose}
      onOpen={onOpen}
    />
  );
}

function EditForm({
  start,
  onClose,
  onOpen,
}: {
  readonly start: WrittenSkill;
  readonly onClose: () => void;
  readonly onOpen: (dialog: SkillDialog) => void;
}): ReactNode {
  const formId = useId();
  const [written, setWritten] = useState(start);
  const saved = useSkillSaved();
  const showToast = useToast();
  const editing = useMutation({
    mutationFn: () =>
      editSkill(start.name, {
        description: written.description,
        instructions: written.instructions,
      }),
    onSuccess: async (skill) => {
      await saved(skill);
      showToast(`${skill.name} saved as version ${skill.version}. It waits for your review.`);
      onOpen({ kind: "review", name: skill.name });
    },
  });
  return (
    <Dialog
      size="medium"
      title={`Edit ${start.name}`}
      onClose={onClose}
      actions={
        <Button type="submit" form={formId} loading={editing.isPending}>
          Save
        </Button>
      }
    >
      <form
        id={formId}
        className="skill-form"
        onSubmit={(event) => {
          event.preventDefault();
          editing.mutate();
        }}
      >
        <p className="dialog-text">
          Saving makes its next version, off until you review it. Running sessions keep theirs.
        </p>
        {editing.error && <RefusalAlert title="The skill can't be saved" error={editing.error} />}
        <SkillFields skill={written} onChange={setWritten} withName={false} />
      </form>
    </Dialog>
  );
}
