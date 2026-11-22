import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  Project,
  ProjectFeature,
  ProjectFeaturesChange,
  ProjectRunEnvironment,
} from "@the-office/contracts";
import { Badge, Switch } from "@the-office/ui";
import type { ReactNode } from "react";
import {
  changeFeatures,
  changeRunEnvironment,
  projectQueries,
  setUpRunEnvironment,
} from "../../api/projects.ts";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import { settingChosenWords, setUpWords } from "../../shell/run-environment-words.ts";
import { useToast } from "../../shell/toasts.tsx";
import { FEATURE_NEEDS, FEATURE_ROWS, needsWords } from "./feature-words.ts";
import { ProjectBlock } from "./project-block.tsx";
import { SetUpTaskLine } from "./set-up-task-line.tsx";

type SwitchedFeature = keyof ProjectFeaturesChange["features"];

/**
 * The Project's feature switches (spec screens/project-page.md, "Features"): a row per feature with
 * a bare `Switch`, saved at once. Run environment's row is the Run environment setting itself: On
 * sets it up as the Run environment block's Set up does, which turns it On at once with a valid
 * .devcontainer/ or adds the set-up Task, and Off turns it off.
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
    mutationFn: (on: boolean) =>
      on ? setUpRunEnvironment(project.id) : changeRunEnvironment(project.id, "off"),
    onSuccess: (saved, on) => {
      keep(saved);
      showToast(on ? setUpWords(saved, project.name) : settingChosenWords(saved, project.name));
    },
  });
  const pending = switching.isPending || turningRunEnvironment.isPending;
  // One switch's refusal shows until the next change, so another's never shows as its own.
  const turn = (feature: ProjectFeature, on: boolean): void => {
    if (feature === "run-environment") {
      switching.reset();
      turningRunEnvironment.mutate(on);
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
              <span className="project-setting-name">
                {name}
                {feature === "run-environment" && project.runEnvironment === "not-decided" && (
                  <Badge>Not decided yet</Badge>
                )}
              </span>
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
