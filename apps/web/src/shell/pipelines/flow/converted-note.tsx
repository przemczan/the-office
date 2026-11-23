import type { Stage } from "@the-office/contracts";
import { Alert, Button } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { isConvertedFlow, optionalStageSentences } from "./converted-flow.ts";

/** Each hidden note is this browser's, never sent to the service. */
const HIDDEN_PREFIX = "the-office.converted-note-hidden.";

/**
 * "Full is now drawn as a flow" (docs/design/pipeline-flow.html): said once while the Pipeline reads
 * as the update converted it, until Hide this note, which this browser keeps by the Pipeline's id.
 */
export function ConvertedNote({
  pipelineId,
  name,
  stages,
}: {
  readonly pipelineId: string;
  readonly name: string;
  readonly stages: readonly Stage[];
}): ReactNode {
  const [hidden, setHidden] = useState(() => storedHidden(pipelineId));
  if (hidden || !isConvertedFlow(stages)) return null;
  const hide = (): void => {
    try {
      localStorage.setItem(HIDDEN_PREFIX + pipelineId, "true");
    } catch {
      // Storage is blocked: the note stays hidden until the page is closed.
    }
    setHidden(true);
  };
  return (
    <Alert
      tone="info"
      title={`${name} is now drawn as a flow`}
      action={
        <Button size="sm" variant="secondary" onClick={hide}>
          Hide this note
        </Button>
      }
    >
      <p>
        As The Office updated, every Pipeline became the same flow drawn as a straight line: its
        Stages in the same order, one route with no condition from each to the next and from the
        last to End, and each On failure setting as a route back with the same limit. Nothing else
        changed, and Tasks walk it as before.
      </p>
      {optionalStageSentences(stages).map((sentence) => (
        <p key={sentence}>{sentence}</p>
      ))}
    </Alert>
  );
}

function storedHidden(pipelineId: string): boolean {
  try {
    return localStorage.getItem(HIDDEN_PREFIX + pipelineId) === "true";
  } catch {
    return false;
  }
}
