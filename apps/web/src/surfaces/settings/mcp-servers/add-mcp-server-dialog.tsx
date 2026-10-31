import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Dialog, Tabs, Textarea } from "@the-office/ui";
import { useId, useState, type ReactNode } from "react";
import { addMcpServer, mcpServerQueries, readPastedConfig } from "../../../api/mcp-servers.ts";
import { RefusalAlert } from "../../../shell/refusal-alert.tsx";
import { draftOfPasted, NEW_MCP_SERVER, newMcpServerOf } from "./mcp-server-draft.ts";
import { McpServerFields } from "./mcp-server-fields.tsx";
import type { McpServerDialog } from "./mcp-servers-section.tsx";

type AddingBy = (typeof TABS)[number]["value"];

const TABS = [
  { value: "form", label: "Fill in the form" },
  { value: "paste", label: "Paste a JSON config" },
] as const;

const PASTED_EXAMPLE = `{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "\${GITHUB_TOKEN}" }
    }
  }
}`;

/**
 * "Add an MCP server": by the form, or by pasting its JSON config, which fills the form for the
 * user to check before adding. However it comes, it arrives off until reviewed.
 */
export function AddMcpServerDialog({
  onClose,
  onOpen,
}: {
  readonly onClose: () => void;
  readonly onOpen: (dialog: McpServerDialog) => void;
}): ReactNode {
  const formId = useId();
  const [by, setBy] = useState<AddingBy>("form");
  const [config, setConfig] = useState("");
  const [draft, setDraft] = useState(NEW_MCP_SERVER);
  const [fromPasted, setFromPasted] = useState(false);
  const queryClient = useQueryClient();
  const reading = useMutation({
    mutationFn: readPastedConfig,
    onSuccess: (pasted) => {
      setDraft(draftOfPasted(pasted));
      setFromPasted(true);
      setBy("form");
    },
  });
  const adding = useMutation({
    mutationFn: addMcpServer,
    onSuccess: async (server) => {
      await queryClient.invalidateQueries(mcpServerQueries.list());
      onOpen({ kind: "review", name: server.name });
    },
  });
  const failure = by === "paste" ? reading.error : adding.error;
  return (
    <Dialog
      title="Add an MCP server"
      width={680}
      onClose={onClose}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form={formId}
            loading={reading.isPending || adding.isPending}
            disabled={by === "paste" && config.trim() === ""}
          >
            {by === "paste" ? "Read the config" : "Add to the library"}
          </Button>
        </>
      }
    >
      <div className="skill-tabs">
        <Tabs
          tabs={[...TABS]}
          value={by}
          onChange={(tab) => setBy(TABS.find(({ value }) => value === tab)?.value ?? "form")}
        />
      </div>
      <form
        id={formId}
        className="skill-form mcp-server-dialog-body"
        onSubmit={(event) => {
          event.preventDefault();
          if (by === "paste") reading.mutate(config);
          else adding.mutate(newMcpServerOf(draft));
        }}
      >
        {failure && <RefusalAlert title="The MCP server can't be added" error={failure} />}
        {by === "paste" ? (
          <Textarea
            label="JSON config"
            rows={10}
            hint="One server, as in Claude Code's mcpServers. Nothing is kept until you add it."
            placeholder={PASTED_EXAMPLE}
            value={config}
            onChange={(event) => setConfig(event.target.value)}
            style={{ fontFamily: "var(--font-mono)" }}
            autoFocus
          />
        ) : (
          <>
            {fromPasted && (
              <Alert tone="info">
                Read from the pasted config. Check which Server values are secret and which are
                required, then add it.
              </Alert>
            )}
            <McpServerFields draft={draft} onChange={setDraft} />
            <p className="dialog-hint">It arrives off until you review it.</p>
          </>
        )}
      </form>
    </Dialog>
  );
}
