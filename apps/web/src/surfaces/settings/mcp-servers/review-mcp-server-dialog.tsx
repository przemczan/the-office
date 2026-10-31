import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { McpServer, McpServerReview, McpServerTool, ServerValue } from "@the-office/contracts";
import {
  Alert,
  Badge,
  Button,
  DescriptionList,
  Dialog,
  Icon,
  type DescriptionListProps,
} from "@the-office/ui";
import type { ReactNode } from "react";
import {
  changeMcpServerState,
  mcpServerQueries,
  removeMcpServer,
} from "../../../api/mcp-servers.ts";
import { RefusalAlert } from "../../../shell/refusal-alert.tsx";
import { useToast } from "../../../shell/toasts.tsx";
import { connectionLine } from "./mcp-server-draft.ts";
import type { McpServerDialog } from "./mcp-servers-section.tsx";

/**
 * Review: the server connected to with its Office-wide values, showing how it runs, its values and
 * the tools it lists; turning it on records those tools, and is refused if they changed since.
 */
export function ReviewMcpServerDialog({
  name,
  onClose,
  onOpen,
}: {
  readonly name: string;
  readonly onClose: () => void;
  readonly onOpen: (dialog: McpServerDialog) => void;
}): ReactNode {
  const review = useQuery(mcpServerQueries.review(name));
  const queryClient = useQueryClient();
  const showToast = useToast();
  const switching = useMutation({
    mutationFn: (reviewed: McpServerReview) =>
      changeMcpServerState(
        name,
        reviewed.server.state === "on" || !reviewed.connected
          ? { state: "off" }
          : { state: "on", reviewDigest: reviewed.reviewDigest },
      ),
    onSuccess: async (server) => {
      await queryClient.invalidateQueries(mcpServerQueries.list());
      showToast(
        server.state === "on"
          ? `${server.name} is on. Assign it on a Role card.`
          : `${server.name} is off. Sessions started from now on don't get it.`,
      );
      onClose();
    },
    // Refused when the server or its tools changed since this review: show them as they are now.
    onError: () => queryClient.invalidateQueries(mcpServerQueries.review(name)),
  });
  const removing = useMutation({
    mutationFn: () => removeMcpServer(name),
    onSuccess: async () => {
      await queryClient.invalidateQueries(mcpServerQueries.list());
      showToast(`${name} removed from the library.`);
      onClose();
    },
  });
  const reviewed = review.data;
  const failure = switching.error ?? removing.error ?? review.error;
  return (
    <Dialog
      title={`Review ${name}`}
      width={720}
      onClose={onClose}
      actions={
        <>
          <Button
            variant="danger-ghost"
            iconLeft={<Icon name="trash-2" size={14} />}
            loading={removing.isPending}
            onClick={() => removing.mutate()}
          >
            Remove it
          </Button>
          <Button variant="ghost" onClick={() => onOpen({ kind: "edit", name })}>
            Edit
          </Button>
          <span className="skill-dialog-spacer" />
          <Button variant="secondary" onClick={onClose}>
            Later
          </Button>
          {reviewed && (
            <Button
              variant={reviewed.server.state === "on" ? "secondary" : "primary"}
              loading={switching.isPending}
              disabled={reviewed.server.state === "off" && !reviewed.connected}
              onClick={() => switching.mutate(reviewed)}
            >
              {reviewed.server.state === "on" ? "Turn it off" : "Turn it on"}
            </Button>
          )}
        </>
      }
    >
      {failure && <RefusalAlert title="That didn't work" error={failure} />}
      {review.isPending && <p className="settings-note">Connecting to {name}…</p>}
      {reviewed && <Review review={reviewed} />}
    </Dialog>
  );
}

function Review({ review }: { readonly review: McpServerReview }): ReactNode {
  const { server } = review;
  return (
    <div className="skill-review mcp-server-dialog-body">
      <DescriptionList items={serverItems(server)} />
      {review.connected ? (
        <ToolList tools={review.tools} toolsTooLong={review.toolsTooLong} />
      ) : (
        <Alert tone="danger" title="It couldn't connect">
          <pre className="mcp-server-problem">{review.problem}</pre>
        </Alert>
      )}
    </div>
  );
}

function ToolList({
  tools,
  toolsTooLong,
}: {
  readonly tools: readonly McpServerTool[];
  readonly toolsTooLong: readonly string[];
}): ReactNode {
  if (tools.length === 0) return <p className="settings-note">It lists no tools.</p>;
  const tooLong = new Set(toolsTooLong);
  return (
    <section className="mcp-server-tools" aria-label="Tools it lists">
      <h3 className="mcp-server-tools-title">
        Tools it lists <span className="settings-count">{tools.length}</span>
      </h3>
      {tooLong.size > 0 && (
        <Alert tone="warning">
          Sessions leave out the tools marked: as mcp__&lt;server&gt;__&lt;tool&gt; their names run
          over the model APIs&apos; 64 characters.
        </Alert>
      )}
      <ul className="mcp-server-tool-list">
        {tools.map((tool) => (
          <li key={tool.name}>
            <span className="mcp-server-tool-name">{tool.name}</span>
            {tooLong.has(tool.name) && <Badge tone="warning">Name too long</Badge>}
            {tool.description !== "" && (
              <div className="mcp-server-tool-description">{tool.description}</div>
            )}
          </li>
        ))}
      </ul>
      <p className="settings-note">
        Each tool starts at Consult Devops in a Role card&apos;s permission profile.
      </p>
    </section>
  );
}

type DescriptionItem = NonNullable<DescriptionListProps["items"]>[number];

/** How it runs, then each Server value. */
function serverItems(server: McpServer): DescriptionItem[] {
  return [
    {
      label: server.transport === "stdio" ? "Local command" : "Remote URL",
      value: connectionLine(server),
      mono: true,
    },
    ...server.serverValues.map((value) => ({ label: value.name, value: serverValueWords(value) })),
  ];
}

/** A Server value as the review shows it: a plain value as it is, a secret only as set or not. */
function serverValueWords(value: ServerValue): string {
  const kind = [value.secret ? "Secret" : "Plain", value.required ? "required" : "optional"].join(
    ", ",
  );
  if (!value.officeWideValueSet) return `Not set (${kind})`;
  return value.secret ? `Set (${kind})` : `${value.officeWideValue ?? ""} (${kind})`;
}
