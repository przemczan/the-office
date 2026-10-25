import { Button, Input, SegmentedControl } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import type { PendingAttachment } from "./pending-attachment.ts";

type Picking = "file" | "link";

const PICKING_OPTIONS = [
  { value: "file", label: "File or screenshot" },
  { value: "link", label: "Link" },
] satisfies { value: Picking; label: string }[];

/**
 * Choosing one Attachment: a file (a Markdown document, an image or any file) or a link. Hands it
 * over with `onPick`, then starts again.
 */
export function AttachmentPicker({
  onPick,
}: {
  readonly onPick: (pending: PendingAttachment) => void;
}): ReactNode {
  const [picking, setPicking] = useState<Picking>("file");
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  // Remounting clears the file input once its file is handed over.
  const [fileInputKey, setFileInputKey] = useState(0);
  return (
    <div className="attachment-picker">
      <SegmentedControl
        size="sm"
        options={PICKING_OPTIONS}
        value={picking}
        onChange={(value) => setPicking(value === "link" ? "link" : "file")}
      />
      {picking === "file" ? (
        <input
          key={fileInputKey}
          className="attachment-file-input"
          type="file"
          aria-label="File to attach"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            onPick({ kind: "file", file });
            setFileInputKey((key) => key + 1);
          }}
        />
      ) : (
        <div className="attachment-link-fields">
          <Input
            label="Address"
            placeholder="https://"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
          <Input
            label="Name"
            hint="Optional; the address names it otherwise."
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <div>
            <Button
              variant="secondary"
              size="sm"
              disabled={url.trim() === ""}
              onClick={() => {
                onPick({ kind: "link", link: { name, url } });
                setUrl("");
                setName("");
              }}
            >
              Add the link
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
