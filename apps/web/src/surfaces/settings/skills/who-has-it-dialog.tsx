import { useMutation, useQuery } from "@tanstack/react-query";
import { officeCommandClash, type Role, type Skill } from "@the-office/contracts";
import { Alert, Button, Checkbox, Dialog, Switch } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { roleQueries } from "../../../api/people.ts";
import { assignSkill, changeSkillEveryone, skillQueries } from "../../../api/skills.ts";
import { officeCommandClashWords } from "../../../shell/commands/command-words.ts";
import { personName } from "../../../shell/person-name.ts";
import { RefusalAlert } from "../../../shell/refusal-alert.tsx";
import { useToast } from "../../../shell/toasts.tsx";
import { useSkillSaved } from "./skill-fields.tsx";

/** Who has a skill: everyone, or the people chosen, as the Skills on each Role card. */
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
  const roles = useQuery(roleQueries.list());
  if (!skill.data || !roles.data) return null;
  return <WhoHasItForm skill={skill.data} roles={roles.data} onClose={onClose} />;
}

function WhoHasItForm({
  skill,
  roles,
  onClose,
}: {
  readonly skill: Skill;
  readonly roles: readonly Role[];
  readonly onClose: () => void;
}): ReactNode {
  const [everyone, setEveryone] = useState(skill.everyone);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set(skill.roles));
  const saved = useSkillSaved();
  const showToast = useToast();
  const saving = useMutation({
    mutationFn: async () => {
      let changed = skill;
      if (everyone !== skill.everyone) changed = await changeSkillEveryone(skill.name, everyone);
      if (!sameRoles(chosen, skill.roles)) changed = await assignSkill(skill.name, [...chosen]);
      return changed;
    },
    onSuccess: async (changed) => {
      await saved(changed);
      showToast("Saved. It applies at each person's next session start.");
      onClose();
    },
  });
  const toggle = (roleKey: string, checked: boolean): void => {
    const next = new Set(chosen);
    if (checked) next.add(roleKey);
    else next.delete(roleKey);
    setChosen(next);
  };
  return (
    <Dialog
      size="medium"
      title={`Who has ${skill.name}`}
      unsavedChanges={everyone !== skill.everyone || !sameRoles(chosen, skill.roles)}
      onClose={onClose}
      actions={
        <Button loading={saving.isPending} onClick={() => saving.mutate()}>
          Save
        </Button>
      }
    >
      <div className="skill-form">
        {saving.error && <RefusalAlert title="That didn't work" error={saving.error} />}
        {officeCommandClash(skill.name) && (
          <Alert tone="warning">{officeCommandClashWords(skill.name)}</Alert>
        )}
        <Switch
          checked={everyone}
          onChange={setEveryone}
          label="Everyone"
          description="Comes with every Role, no assignment needed"
        />
        {roles.length > 0 ? (
          <div className="skill-people">
            {roles.map((role) => (
              <Checkbox
                key={role.key}
                checked={everyone || chosen.has(role.key)}
                disabled={everyone}
                onChange={(checked) => toggle(role.key, checked)}
                label={personName(role)}
              />
            ))}
          </div>
        ) : (
          <p className="settings-note">Nobody is hired yet. Hire people on People.</p>
        )}
        <p className="settings-note">
          The same choice as the Skills on each Role card. Running sessions keep the skills they
          started with.
        </p>
      </div>
    </Dialog>
  );
}

function sameRoles(chosen: ReadonlySet<string>, roles: readonly string[]): boolean {
  return chosen.size === roles.length && roles.every((roleKey) => chosen.has(roleKey));
}
