import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Project, ProjectSkill } from "@the-office/contracts";
import { Switch } from "@the-office/ui";
import type { ReactNode } from "react";
import {
  changeProjectSkillUse,
  changeUseProjectSkills,
  projectQueries,
} from "../../api/projects.ts";
import { SkillChip } from "../../shell/skill-chip.tsx";
import { useToast } from "../../shell/toasts.tsx";
import { ProjectBlock } from "./project-block.tsx";

/** In turn, so an earlier answer never lands after a later one. */
function skillSwitchScope(project: Project): { readonly id: string } {
  return { id: `project-skill-switches-${project.id}` };
}

/**
 * The repository's own skills, read-only, with the switches that give them to sessions in the
 * Project (spec §2.6): one for all of them, and one for each. They stay in the repository; a Task
 * changes them.
 */
export function SkillsBlock({ project }: { readonly project: Project }): ReactNode {
  const skills = useQuery(projectQueries.skills(project.id));
  const queryClient = useQueryClient();
  const showToast = useToast();
  const switching = useMutation({
    scope: skillSwitchScope(project),
    mutationFn: (use: boolean) => changeUseProjectSkills(project.id, use),
    onSuccess: (saved) => {
      queryClient.setQueryData(projectQueries.one(saved.id).queryKey, saved);
      showToast(
        saved.useProjectSkills
          ? `Sessions in ${saved.name} get its own skills from their next start.`
          : `Sessions in ${saved.name} start without its own skills.`,
      );
    },
  });
  const found = skills.data ?? [];
  return (
    <ProjectBlock
      icon="sparkles"
      title={`Skills in the repository${skills.data ? ` ${found.length}` : ""}`}
      note={
        found.length > 0
          ? "Read-only: they live in the repository, and The Office neither stores nor copies them. Change them with a Task."
          : undefined
      }
    >
      {skills.data && found.length === 0 && (
        <p className="project-block-text">
          The repository has no <code>.claude/skills</code>. Skills from the library are given per
          Role in Settings › Skills.
        </p>
      )}
      {found.length > 0 && (
        <div className="project-skills">
          <Switch
            checked={project.useProjectSkills}
            disabled={switching.isPending}
            onChange={(use) => switching.mutate(use)}
            label="Use this Project's skills"
            description={`Anyone working in ${project.name} gets the ones turned on below, besides their Role's skills.`}
          />
          <ul className="project-skill-list">
            {found.map((skill) => (
              <SkillLine
                key={skill.path}
                project={project}
                skill={skill}
                sameKey={found.filter(({ key, path }) => key === skill.key && path !== skill.path)}
              />
            ))}
          </ul>
        </div>
      )}
      {(skills.error ?? switching.error) && (
        <p className="project-block-error" role="alert">
          {(skills.error ?? switching.error)?.message}
        </p>
      )}
    </ProjectBlock>
  );
}

function SkillLine({
  project,
  skill,
  sameKey,
}: {
  readonly project: Project;
  readonly skill: ProjectSkill;
  /** The other rows the engine takes for this same skill. */
  readonly sameKey: readonly ProjectSkill[];
}): ReactNode {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const switching = useMutation({
    scope: skillSwitchScope(project),
    mutationFn: (use: boolean) => changeProjectSkillUse(project.id, skill.key, use),
    onSuccess: (saved, use) => {
      queryClient.setQueryData(projectQueries.one(saved.id).queryKey, saved);
      showToast(
        use
          ? `Sessions in ${saved.name} get ${skill.name} from their next start.`
          : `Sessions in ${saved.name} start without ${skill.name}.`,
      );
    },
  });
  const turnedOn = !project.projectSkillsOff.includes(skill.key);
  const sessionsGetIt = project.useProjectSkills && turnedOn;
  return (
    <li className={`project-skill${sessionsGetIt ? "" : " off"}`}>
      <div
        role="group"
        aria-label={skill.name}
        className="project-skill-row"
        title={project.useProjectSkills ? undefined : "Use this Project's skills is off"}
      >
        {/* Beside the Switch, not its label: a label's click anywhere flips it, so selecting a
            path to copy it would change what sessions get. */}
        <div className="project-skill-text">
          <SkillChip name={skill.name} />
          <SkillDetails skill={skill} sessionsGetIt={sessionsGetIt} sameKey={sameKey} />
        </div>
        <Switch
          size="sm"
          checked={turnedOn}
          disabled={!project.useProjectSkills || switching.isPending}
          onChange={(use) => switching.mutate(use)}
        />
      </div>
      {switching.error && (
        <p className="project-block-error" role="alert">
          {switching.error.message}
        </p>
      )}
    </li>
  );
}

function SkillDetails({
  skill,
  sessionsGetIt,
  sameKey,
}: {
  readonly skill: ProjectSkill;
  readonly sessionsGetIt: boolean;
  readonly sameKey: readonly ProjectSkill[];
}): ReactNode {
  return (
    <span className="project-skill-details">
      {skill.description && (
        <span className="project-skill-description" title={skill.description}>
          {skill.description}
        </span>
      )}
      <code className="project-skill-path">{skill.path}</code>
      {!skill.listedAtStart && <span>Listed once a file below it is read.</span>}
      {sameKey.length > 0 && (
        <span>
          Switches together with {sameKey.map(({ path }) => path).join(", ")}: a session knows them
          as one skill.
        </span>
      )}
      {skill.alsoInLibrary && sessionsGetIt && (
        <span className="project-skill-warning">
          The library has a skill of this name too; a session with both lists both.
        </span>
      )}
    </span>
  );
}
