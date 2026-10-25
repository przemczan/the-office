import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Project, RepositorySkill } from "@the-office/contracts";
import { Switch } from "@the-office/ui";
import type { ReactNode } from "react";
import { changeUseOfSkills, projectQueries } from "../../api/projects.ts";
import { SkillChip } from "../../shell/skill-chip.tsx";
import { useToast } from "../../shell/toasts.tsx";
import { ProjectBlock } from "./project-block.tsx";

/**
 * The repository's own skills, read-only, with the switch that gives them to sessions in the
 * Project (spec §2.6). They stay in the repository; a Task changes them.
 */
export function SkillsBlock({ project }: { readonly project: Project }): ReactNode {
  const skills = useQuery(projectQueries.skills(project.id));
  const queryClient = useQueryClient();
  const showToast = useToast();
  const switching = useMutation({
    mutationFn: (use: boolean) => changeUseOfSkills(project.id, use),
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
        <>
          <div className="project-skills-switch">
            <Switch
              checked={project.useProjectSkills}
              disabled={switching.isPending}
              onChange={(use) => switching.mutate(use)}
              label="Use this Project's skills"
              description={`Anyone working in ${project.name} gets them besides their Role's skills.`}
            />
          </div>
          <ul className={`project-skills${project.useProjectSkills ? "" : " off"}`}>
            {found.map((skill) => (
              <SkillLine key={skill.path} skill={skill} />
            ))}
          </ul>
        </>
      )}
      {(skills.error ?? switching.error) && (
        <p className="project-block-error" role="alert">
          {(skills.error ?? switching.error)?.message}
        </p>
      )}
    </ProjectBlock>
  );
}

function SkillLine({ skill }: { readonly skill: RepositorySkill }): ReactNode {
  return (
    <li className="project-skill">
      <SkillChip name={skill.name} />
      <span className="project-skill-description">
        {skill.description}
        {!skill.listedAtStart && (
          <span className="project-skill-hint"> Listed once a file below it is read.</span>
        )}
        {skill.alsoInLibrary && (
          <span className="project-skill-warning">
            {" "}
            The library has a skill of this name too; a session with both lists both.
          </span>
        )}
      </span>
      <code className="project-skill-path">{skill.path}</code>
    </li>
  );
}
