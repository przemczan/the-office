import { useMutation, useQuery } from "@tanstack/react-query";
import type { Skill } from "@the-office/contracts";
import { Button, Dialog, Switch } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { changeSkillEveryone, skillQueries } from "../../../api/skills.ts";
import { RefusalAlert } from "../../../shell/refusal-alert.tsx";
import { useToast } from "../../../shell/toasts.tsx";
import { useSkillSaved } from "./skill-fields.tsx";

/** Who has a skill: everyone, or (with Role cards, task 08) the people chosen. */
export function WhoHasItDialog({
  name,
  onClose,
}: {
  readonly name: string;
  readonly onClose: () => void;
}): ReactNode {
  const skill = useQuery({
    ...skillQueries.list(),
    select: (skills) => skills.find((candidate) => candidate.name === name),
  });
  if (!skill.data) return null;
  return <WhoHasItForm skill={skill.data} onClose={onClose} />;
}

function WhoHasItForm({
  skill,
  onClose,
}: {
  readonly skill: Skill;
  readonly onClose: () => void;
}): ReactNode {
  const [everyone, setEveryone] = useState(skill.everyone);
  const saved = useSkillSaved();
  const showToast = useToast();
  const saving = useMutation({
    mutationFn: () => changeSkillEveryone(skill.name, everyone),
    onSuccess: async (changed) => {
      await saved(changed);
      showToast("Saved. It applies at each session start from now on.");
      onClose();
    },
  });
  return (
    <Dialog
      title={`Who has ${skill.name}`}
      width={520}
      onClose={onClose}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={saving.isPending} onClick={() => saving.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="skill-form">
        {saving.error && <RefusalAlert title="That didn't work" error={saving.error} />}
        <Switch
          checked={everyone}
          onChange={setEveryone}
          label="Everyone"
          description="Comes with every Role, no assignment needed"
        />
        <p className="settings-note">Running sessions keep the skills they started with.</p>
      </div>
    </Dialog>
  );
}
