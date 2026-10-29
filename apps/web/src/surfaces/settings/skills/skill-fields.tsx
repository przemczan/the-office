import { useQueryClient } from "@tanstack/react-query";
import type { Skill, WrittenSkill } from "@the-office/contracts";
import { Input, Textarea } from "@the-office/ui";
import type { ReactNode } from "react";
import { skillQueries } from "../../../api/skills.ts";

/** The Write form's fields; a written skill's name is kept, so editing leaves it out. */
export function SkillFields({
  skill,
  onChange,
  withName,
}: {
  readonly skill: WrittenSkill;
  readonly onChange: (skill: WrittenSkill) => void;
  readonly withName: boolean;
}): ReactNode {
  return (
    <>
      {withName && (
        <Input
          label="Name"
          placeholder="release-notes"
          hint="Lowercase words joined by dashes. It names the skill's folder."
          value={skill.name}
          onChange={(event) => onChange({ ...skill, name: event.target.value })}
          inputStyle={{ fontFamily: "var(--font-mono)" }}
          autoFocus
        />
      )}
      <Textarea
        label="Description"
        rows={2}
        placeholder="When to use it, in one sentence: this is what sits in every session's context"
        hint="Every session that has the skill lists it, so short is better; Review flags a long one."
        value={skill.description}
        onChange={(event) => onChange({ ...skill, description: event.target.value })}
        autoFocus={!withName}
      />
      <Textarea
        label="Instructions"
        rows={8}
        value={skill.instructions}
        onChange={(event) => onChange({ ...skill, instructions: event.target.value })}
      />
    </>
  );
}

/** A file picker for a skill: a single `.md`, or a zipped folder. */
export function SkillFileInput({
  onChange,
}: {
  readonly onChange: (file: File | undefined) => void;
}): ReactNode {
  return (
    <input
      className="skill-file-input"
      type="file"
      accept=".md,.zip"
      aria-label="A single .md file or a zipped folder"
      onChange={(event) => onChange(event.target.files?.[0])}
    />
  );
}

/** After a change to a skill: the library and its review are read again. */
export function useSkillSaved(): (skill: Skill) => Promise<void> {
  const queryClient = useQueryClient();
  return async (skill) => {
    await Promise.all([
      queryClient.invalidateQueries(skillQueries.list()),
      queryClient.invalidateQueries(skillQueries.review(skill.name)),
    ]);
  };
}
