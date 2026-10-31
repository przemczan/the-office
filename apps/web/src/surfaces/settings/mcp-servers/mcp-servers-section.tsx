import { useQuery } from "@tanstack/react-query";
import type { McpServer, Role } from "@the-office/contracts";
import { Alert, Badge, Button, Card, DataTable, Icon, type DataTableColumn } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { mcpServerQueries } from "../../../api/mcp-servers.ts";
import { roleQueries } from "../../../api/people.ts";
import { usePageHeading } from "../../../shell/page-heading.tsx";
import { AddMcpServerDialog } from "./add-mcp-server-dialog.tsx";
import { EditMcpServerDialog } from "./edit-mcp-server-dialog.tsx";
import { connectionLine, serverValuesLine } from "./mcp-server-draft.ts";
import { ReviewMcpServerDialog } from "./review-mcp-server-dialog.tsx";
import "./mcp-servers.css";

/** Which dialog is open over the library, and for which server. */
export type McpServerDialog =
  { readonly kind: "add" } | { readonly kind: "review" | "edit"; readonly name: string };

/** Settings › MCP servers: the library, each server reviewed before it can be turned on. */
export function McpServersSection(): ReactNode {
  usePageHeading({ title: "Settings", crumb: "MCP servers" });
  const servers = useQuery(mcpServerQueries.list());
  const roles = useQuery(roleQueries.list());
  const [dialog, setDialog] = useState<McpServerDialog>();
  const close = (): void => setDialog(undefined);
  const library = servers.data ?? [];
  return (
    <>
      <Card
        title={
          <span className="settings-block-title">
            <Icon name="plug" size={15} strokeWidth={1.6} />
            The MCP server library <span className="settings-count">{library.length}</span>
          </span>
        }
        actions={
          <Button
            size="sm"
            iconLeft={<Icon name="plus" size={14} />}
            onClick={() => setDialog({ kind: "add" })}
          >
            Add an MCP server
          </Button>
        }
      >
        <p className="settings-note">
          A local command or a remote URL whose tools a person may use when their Role card assigns
          it. A server is off until you review it: the review connects to it and lists its tools.
          Each tool starts at Consult Devops in the Role card&apos;s permission profile.
        </p>
        {servers.error && (
          <div className="settings-banner">
            <Alert tone="danger" title="The library can't be read">
              {servers.error.message}
            </Alert>
          </div>
        )}
      </Card>
      <Card padding="none">
        <DataTable
          rowKey="name"
          density="relaxed"
          rows={library}
          columns={columns(setDialog, roles.data ?? [])}
          loading={servers.isPending}
          empty="The library is empty. Add an MCP server by the form or by pasting its JSON config."
        />
      </Card>
      {dialog?.kind === "add" && <AddMcpServerDialog onClose={close} onOpen={setDialog} />}
      {dialog?.kind === "review" && (
        <ReviewMcpServerDialog name={dialog.name} onClose={close} onOpen={setDialog} />
      )}
      {dialog?.kind === "edit" && (
        <EditMcpServerDialog name={dialog.name} onClose={close} onOpen={setDialog} />
      )}
    </>
  );
}

function columns(
  open: (dialog: McpServerDialog) => void,
  roles: readonly Role[],
): DataTableColumn<McpServer>[] {
  return [
    {
      key: "name",
      header: "MCP server",
      wrap: true,
      render: (server) => (
        <>
          <div className="mcp-server-name">{server.name}</div>
          <div className="mcp-server-connection">{connectionLine(server)}</div>
        </>
      ),
    },
    {
      key: "serverValues",
      header: "Server values",
      render: (server) => (
        <span className="skill-holders">{serverValuesLine(server.serverValues)}</span>
      ),
    },
    {
      key: "roles",
      header: "Who has it",
      render: (server) => <span className="skill-holders">{holdersLine(server, roles)}</span>,
    },
    {
      key: "state",
      header: "State",
      render: (server) =>
        server.state === "on" ? (
          <Badge tone="success" dot>
            On
          </Badge>
        ) : (
          <Badge tone="neutral" dot>
            Off
          </Badge>
        ),
    },
    {
      key: "actions",
      header: <span className="visually-hidden">Actions</span>,
      align: "right",
      render: (server) => (
        <div className="skill-actions">
          <Button
            size="sm"
            variant={server.state === "off" ? "primary" : "ghost"}
            onClick={() => open({ kind: "review", name: server.name })}
          >
            Review
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => open({ kind: "edit", name: server.name })}
          >
            Edit
          </Button>
        </div>
      ),
    },
  ];
}

/** The people whose Role card assigns the server, by first name, as Settings › Skills shows them. */
function holdersLine(server: McpServer, roles: readonly Role[]): string {
  const names = roles
    .filter((role) => server.roles.includes(role.key))
    .map((role) => role.card.name);
  return names.length > 0 ? names.join(", ") : "Nobody";
}
