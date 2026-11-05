import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { McpServer } from "@the-office/contracts";
import { Button, Dialog } from "@the-office/ui";
import { useId, useState, type ReactNode } from "react";
import { changeMcpServer, mcpServerQueries } from "../../../api/mcp-servers.ts";
import { RefusalAlert } from "../../../shell/refusal-alert.tsx";
import { useToast } from "../../../shell/toasts.tsx";
import { draftOfServer, mcpServerEditOf } from "./mcp-server-draft.ts";
import { McpServerFields } from "./mcp-server-fields.tsx";
import type { McpServerDialog } from "./mcp-servers-section.tsx";

/** Edit: how it runs and its Server values; a change to what runs turns it off until reviewed. */
export function EditMcpServerDialog({
  name,
  onClose,
  onOpen,
}: {
  readonly name: string;
  readonly onClose: () => void;
  readonly onOpen: (dialog: McpServerDialog) => void;
}): ReactNode {
  const server = useQuery({
    ...mcpServerQueries.list(),
    select: (servers) => servers.find((candidate) => candidate.name === name),
  });
  if (!server.data) return null;
  return <EditMcpServerForm saved={server.data} onClose={onClose} onOpen={onOpen} />;
}

function EditMcpServerForm({
  saved,
  onClose,
  onOpen,
}: {
  readonly saved: McpServer;
  readonly onClose: () => void;
  readonly onOpen: (dialog: McpServerDialog) => void;
}): ReactNode {
  const formId = useId();
  const [draft, setDraft] = useState(() => draftOfServer(saved));
  const queryClient = useQueryClient();
  const showToast = useToast();
  const saving = useMutation({
    mutationFn: () => changeMcpServer(saved.name, mcpServerEditOf(draft)),
    onSuccess: async (server) => {
      await queryClient.invalidateQueries(mcpServerQueries.list());
      if (server.state === "on") {
        showToast("Saved. Sessions started from now on use it.");
        onClose();
        return;
      }
      if (saved.state === "on") {
        showToast(`${server.name} changed, so it is off until you review it again.`);
      }
      onOpen({ kind: "review", name: server.name });
    },
  });
  return (
    <Dialog
      size="medium"
      title={`Edit ${saved.name}`}
      onClose={onClose}
      actions={
        <Button type="submit" form={formId} loading={saving.isPending}>
          Save
        </Button>
      }
    >
      <form
        id={formId}
        className="skill-form"
        onSubmit={(event) => {
          event.preventDefault();
          saving.mutate();
        }}
      >
        {saving.error && <RefusalAlert title="That didn't work" error={saving.error} />}
        <McpServerFields draft={draft} saved={saved} onChange={setDraft} />
        <p className="dialog-hint">
          Changing the command, its arguments, the URL or a Server value&apos;s name turns it off
          until you review it again.
        </p>
      </form>
    </Dialog>
  );
}
