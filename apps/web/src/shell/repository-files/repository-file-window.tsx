import { Button, Dialog } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { RepositoryFileBrowser, type RepositoryFile } from "./repository-file-browser.tsx";

/** The window to pick one file committed on a Project's base branch; the caller closes it after a pick. */
export function RepositoryFileWindow({
  projectId,
  title,
  extensions,
  onPick,
  onClose,
}: {
  readonly projectId: string;
  readonly title: string;
  /** Only files with these extensions show; none shows every file. */
  readonly extensions: readonly string[];
  readonly onPick: (file: RepositoryFile) => void;
  readonly onClose: () => void;
}): ReactNode {
  const [selected, setSelected] = useState<RepositoryFile | null>(null);
  return (
    <Dialog
      size="medium"
      title={title}
      unsavedChanges={selected !== null}
      onClose={onClose}
      actions={
        <Button
          disabled={selected === null}
          title={selected === null ? "Select a file in the list first." : undefined}
          onClick={() => {
            if (selected !== null) onPick(selected);
          }}
        >
          Choose file
        </Button>
      }
    >
      <RepositoryFileBrowser
        projectId={projectId}
        extensions={extensions}
        selected={selected}
        onSelect={setSelected}
      />
    </Dialog>
  );
}
