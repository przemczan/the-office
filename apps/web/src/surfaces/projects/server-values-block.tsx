import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { Project, ProjectMcpServerValues, ProjectServerValue } from "@the-office/contracts";
import { Button, Icon, IconButton, Input } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { changeProjectServerValues, projectQueries } from "../../api/projects.ts";
import { SecretValueInput } from "../../shell/secret-value-input.tsx";
import { useToast } from "../../shell/toasts.tsx";
import { ProjectBlock } from "./project-block.tsx";
import {
  leavesServerOut,
  officeWideWords,
  projectValueWords,
  serverValuesChangeOf,
  serverValuesDraftOf,
  type ServerValuesDraft,
} from "./server-values-draft.ts";

/**
 * The MCP servers' Server values with this Project's own, which win over the Office-wide ones in
 * its sessions (spec §5.4). Secrets show only as set or not.
 */
export function ServerValuesBlock({ project }: { readonly project: Project }): ReactNode {
  const servers = useQuery(projectQueries.serverValues(project.id));
  const [editing, setEditing] = useState<string>();
  return (
    <ProjectBlock
      icon="plug"
      title="Server values"
      note="A value set here wins over the Office-wide one in this Project's sessions; chat uses the Office-wide values."
    >
      {servers.data?.length === 0 && (
        <p className="project-block-text">
          No MCP server in the library has Server values. Add servers in{" "}
          <Link to="/settings/mcp-servers">Settings › MCP servers</Link>.
        </p>
      )}
      {servers.data?.map((server) =>
        server.serverName === editing ? (
          <ServerValuesEditor
            key={server.serverName}
            project={project}
            server={server}
            onDone={() => setEditing(undefined)}
          />
        ) : (
          <ServerValuesView
            key={server.serverName}
            server={server}
            onEdit={() => setEditing(server.serverName)}
          />
        ),
      )}
      {servers.error && (
        <p className="project-block-error" role="alert">
          {servers.error.message}
        </p>
      )}
    </ProjectBlock>
  );
}

function ServerValuesView({
  server,
  onEdit,
}: {
  readonly server: ProjectMcpServerValues;
  readonly onEdit: () => void;
}): ReactNode {
  return (
    <section className="server-values-server" aria-label={`MCP server ${server.serverName}`}>
      <div className="server-values-server-head">
        <code>{server.serverName}</code>
        <IconButton
          icon={<Icon name="pencil" size={14} />}
          label={`Change ${server.serverName}'s values for this Project`}
          size="sm"
          onClick={onEdit}
        />
      </div>
      <ul className="server-values-list">
        {server.serverValues.map((value) => (
          <li key={value.name} aria-label={`Server value ${value.name}`}>
            <code className="server-values-name">{value.name}</code>
            <span>
              <span className="server-values-label">Office-wide</span> {officeWideWords(value)}
            </span>
            <span>
              <span className="server-values-label">This Project</span> {projectValueWords(value)}
            </span>
            {leavesServerOut(value) && (
              <span className="server-values-warning">
                Required: sessions leave the server out until it has a value.
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ServerValuesEditor({
  project,
  server,
  onDone,
}: {
  readonly project: Project;
  readonly server: ProjectMcpServerValues;
  readonly onDone: () => void;
}): ReactNode {
  const [draft, setDraft] = useState(() => serverValuesDraftOf(server.serverValues));
  const queryClient = useQueryClient();
  const showToast = useToast();
  const saving = useMutation({
    mutationFn: () =>
      changeProjectServerValues(
        project.id,
        server.serverName,
        serverValuesChangeOf(server.serverValues, draft),
      ),
    // No event follows a Project's values, so the page takes them from the answer.
    onSuccess: (saved) => {
      queryClient.setQueryData(projectQueries.serverValues(project.id).queryKey, (servers) =>
        servers?.map((each) => (each.serverName === saved.serverName ? saved : each)),
      );
      showToast(`Server values saved. Sessions in ${project.name} get them from their next start.`);
      onDone();
    },
  });
  const change = (name: string, typed: string | undefined): void =>
    setDraft({ ...draft, [name]: typed });
  return (
    <form
      className="server-values-server editing"
      aria-label={`MCP server ${server.serverName}`}
      onSubmit={(event) => {
        event.preventDefault();
        saving.mutate();
      }}
    >
      <div className="server-values-server-head">
        <code>{server.serverName}</code>
      </div>
      {server.serverValues.map((value) => (
        <ProjectValueField key={value.name} value={value} draft={draft} change={change} />
      ))}
      <div className="server-values-actions">
        <Button type="submit" variant="primary" size="sm" loading={saving.isPending}>
          Save
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={onDone}>
          Cancel
        </Button>
      </div>
      {saving.error && (
        <p className="project-block-error" role="alert">
          {saving.error.message}
        </p>
      )}
    </form>
  );
}

function ProjectValueField({
  value,
  draft,
  change,
}: {
  readonly value: ProjectServerValue;
  readonly draft: ServerValuesDraft;
  readonly change: (name: string, typed: string | undefined) => void;
}): ReactNode {
  const label = `${value.name} for this Project`;
  if (value.secret) {
    return (
      <SecretValueInput
        label={label}
        typed={draft[value.name]}
        set={value.projectValueSet}
        change={(typed) => change(value.name, typed)}
      />
    );
  }
  return (
    <Input
      label={label}
      hint={
        value.officeWideValueSet
          ? `Empty: the Office-wide value applies, ${officeWideWords(value)}.`
          : "Empty: no value, as none is set Office-wide."
      }
      value={draft[value.name] ?? ""}
      onChange={(event) => change(value.name, event.target.value)}
    />
  );
}
