import type { Stage } from "@the-office/contracts";
import { Alert, Button } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { isConvertedFlow, optionalStageSentences } from "./converted-flow.ts";

/** Each hidden note is this browser's, never sent to the service. */
const HIDDEN_PREFIX = "the-office.converted-note-hidden.";

/**
 * The moved-flow note, "Full now goes back by routes" (docs/spec/screens/pipeline-flow-editor.md):
 * said while the Pipeline reads as The Office's move left it, until Hide this note, which this
 * browser keeps by the Pipeline's id.
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
      title={`${name} now goes back by routes`}
      action={
        <Button size="sm" variant="secondary" onClick={hide}>
          Hide this note
        </Button>
      }
    >
      <p>
        As The Office updated, each On failure setting became a route back with the same limit,
        Publish became a Publish Stage, and a conflict at Publish now goes by the conflict chain
        drawn in: Resolve, Test after Resolve, then Publish again. Tasks walk it as before.
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
