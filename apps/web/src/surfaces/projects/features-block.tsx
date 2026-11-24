import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  Project,
  ProjectFeature,
  ProjectFeaturesChange,
  ProjectRunEnvironment,
  RunEnvironmentSetting,
} from "@the-office/contracts";
import { Switch } from "@the-office/ui";
import type { ReactNode } from "react";
import { changeFeatures, changeRunEnvironment, projectQueries } from "../../api/projects.ts";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import { settingChosenWords } from "../../shell/run-environment-words.ts";
import { useToast } from "../../shell/toasts.tsx";
import { FEATURE_NEEDS, FEATURE_ROWS, needsWords } from "./feature-words.ts";
import { ProjectBlock } from "./project-block.tsx";
import { SetUpTaskLine } from "./set-up-task-line.tsx";

type SwitchedFeature = keyof ProjectFeaturesChange["features"];

/**
 * The Project's feature switches (spec screens/project-page.md, "Features"): a row per feature with
 * a bare `Switch`, saved at once. Run environment's row is the Run environment setting itself, turned
 * On or Off at once whatever the base branch holds: each Task reads the .devcontainer/ on its own
 * branch.
 */
export function FeaturesBlock({ project }: { readonly project: Project }): ReactNode {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const runEnvironment = useQuery(projectQueries.runEnvironment(project.id));
  const switching = useMutation({
    scope: { id: `features-${project.id}` },
    mutationFn: (change: { readonly feature: SwitchedFeature; readonly on: boolean }) =>
      changeFeatures(project.id, { [change.feature]: change.on }),
    onSuccess: (saved) => {
      queryClient.setQueryData(projectQueries.one(saved.id).queryKey, saved);
    },
  });
  const keep = (saved: ProjectRunEnvironment): void => {
    queryClient.setQueryData(projectQueries.runEnvironment(project.id).queryKey, saved);
    void queryClient.invalidateQueries({ queryKey: projectQueries.one(project.id).queryKey });
  };
  const turningRunEnvironment = useMutation({
    scope: { id: `features-${project.id}` },
    mutationFn: (setting: RunEnvironmentSetting) => changeRunEnvironment(project.id, setting),
    onSuccess: (saved) => {
      keep(saved);
      showToast(settingChosenWords(saved, project.name));
    },
  });
  const pending = switching.isPending || turningRunEnvironment.isPending;
  // One switch's refusal shows until the next change, so another's never shows as its own.
  const turn = (feature: ProjectFeature, on: boolean): void => {
    if (feature === "run-environment") {
      switching.reset();
      turningRunEnvironment.mutate(on ? "on" : "off");
      return;
    }
    turningRunEnvironment.reset();
    switching.mutate({ feature, on });
  };
  const failure = switching.error ?? turningRunEnvironment.error;
  const setUpTask =
    project.runEnvironment === "on" ? null : (runEnvironment.data?.setUpTask ?? null);
  return (
    <ProjectBlock icon="toggle-right" title="Features">
      {FEATURE_ROWS.map(({ feature, name, line }) => {
        const needed = FEATURE_NEEDS[feature];
        const held = needed !== undefined && !project.features[needed];
        return (
          <div key={feature} className="project-setting" role="group" aria-label={name}>
            <div className="project-setting-words">
              <span className="project-setting-name">{name}</span>
              <span className="project-setting-line">{line}</span>
              {held && <span className="project-setting-line">{needsWords(needed)}</span>}
              {feature === "run-environment" && setUpTask !== null && (
                <SetUpTaskLine task={setUpTask}>
                  Run environment turns On when it is Done.
                </SetUpTaskLine>
              )}
            </div>
            <div className="project-setting-control inline">
              <Switch
                checked={project.features[feature]}
                disabled={pending || held}
                onChange={(on) => turn(feature, on)}
              />
            </div>
          </div>
        );
      })}
      {failure && <RefusalAlert title="The switch wasn't changed" error={failure} />}
    </ProjectBlock>
  );
}
