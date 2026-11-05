import type { TaskStage } from "@the-office/contracts";
import type { ReactNode } from "react";
import { StageMark } from "./stage-mark.tsx";
import { railStateWords } from "./stage-rail-words.ts";
import type { StageNames } from "./stage-words.ts";

/**
 * The top of the Stage history: each Stage's mark and name on the line, to move between them. Focus
 * sits on the Stage shown, as a window takes none of its own and the rail is behind it.
 */
export function PipelineInSmall({
  stages,
  selectedKey,
  names,
  onSelect,
}: {
  readonly stages: readonly TaskStage[];
  readonly selectedKey: string;
  readonly names: StageNames;
  readonly onSelect: (stageKey: string) => void;
}): ReactNode {
  return (
    <ol className="pipeline-in-small" aria-label="Stages">
      {stages.map((taskStage) => {
        const { key, name } = taskStage.stage;
        const isSelected = key === selectedKey;
        return (
          <li key={key}>
            <button
              ref={isSelected ? takeFocus : undefined}
              type="button"
              className="pipeline-in-small-stage"
              aria-pressed={isSelected}
              title={`${name}: ${railStateWords(taskStage, names)}`}
              onClick={() => onSelect(key)}
            >
              <StageMark taskStage={taskStage} small />
              <span className="pipeline-in-small-name">{name}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/** One function for every render, so focus moves only when another Stage becomes the one shown. */
function takeFocus(stage: HTMLButtonElement | null): void {
  stage?.focus();
}
