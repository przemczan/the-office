import type { McpServer, ServerValue, ServerValueEdit } from "@the-office/contracts";
import {
  Button,
  Checkbox,
  Field,
  Icon,
  IconButton,
  Input,
  SegmentedControl,
  Textarea,
} from "@the-office/ui";
import type { ReactNode } from "react";
import { SecretValueInput } from "../../../shell/secret-value-input.tsx";
import {
  NEW_SERVER_VALUE,
  secretValueSet,
  withSecret,
  withSecretValue,
  type McpServerDraft,
} from "./mcp-server-draft.ts";

const TRANSPORTS = [
  { value: "stdio", label: "Local command" },
  { value: "streamable-http", label: "Remote URL" },
] as const;

/**
 * The form of an MCP server: its name (only while adding, as it names its tools), how it runs and
 * its Server values. `saved` is the server as kept, for what saving does with each secret.
 */
export function McpServerFields({
  draft,
  saved,
  onChange,
}: {
  readonly draft: McpServerDraft;
  readonly saved?: McpServer;
  readonly onChange: (draft: McpServerDraft) => void;
}): ReactNode {
  const local = draft.transport === "stdio";
  const changeValue = (index: number, value: ServerValueEdit): void =>
    onChange({
      ...draft,
      serverValues: draft.serverValues.map((kept, at) => (at === index ? value : kept)),
    });
  const removeValue = (index: number): void =>
    onChange({ ...draft, serverValues: draft.serverValues.filter((_value, at) => at !== index) });
  return (
    <>
      {saved === undefined && (
        <Input
          label="Name"
          placeholder="github"
          hint="Lowercase words joined by single dashes, at most 32 characters. It names the server's tools and never changes."
          value={draft.name}
          onChange={(event) => onChange({ ...draft, name: event.target.value })}
          inputStyle={{ fontFamily: "var(--font-mono)" }}
          autoFocus={draft.name === ""}
        />
      )}
      <Field label="How it runs">
        <SegmentedControl
          size="sm"
          options={[...TRANSPORTS]}
          value={draft.transport}
          onChange={(transport) =>
            onChange({ ...draft, transport: transport === "stdio" ? "stdio" : "streamable-http" })
          }
        />
      </Field>
      {local ? (
        <>
          <Input
            label="Command"
            placeholder="npx"
            hint="Started in the session's folder; ended with the session."
            value={draft.command}
            onChange={(event) => onChange({ ...draft, command: event.target.value })}
            inputStyle={{ fontFamily: "var(--font-mono)" }}
          />
          <Textarea
            label="Arguments"
            rows={3}
            hint="One per line."
            value={draft.argumentLines}
            onChange={(event) => onChange({ ...draft, argumentLines: event.target.value })}
            style={{ fontFamily: "var(--font-mono)" }}
          />
        </>
      ) : (
        <Input
          label="URL"
          placeholder="https://mcp.example.com/mcp"
          hint="Its Streamable HTTP address."
          value={draft.url}
          onChange={(event) => onChange({ ...draft, url: event.target.value })}
          inputStyle={{ fontFamily: "var(--font-mono)" }}
        />
      )}
      <div className="server-values" role="group" aria-label="Server values">
        <div className="server-values-head">
          <span className="server-values-title">
            Server values · {local ? "environment variables" : "headers"}
          </span>
          <Button
            variant="ghost"
            size="sm"
            iconLeft={<Icon name="plus" size={14} />}
            onClick={() =>
              onChange({ ...draft, serverValues: [...draft.serverValues, NEW_SERVER_VALUE] })
            }
          >
            Add a Server value
          </Button>
        </div>
        <p className="settings-note">
          Set Office-wide here; a Project&apos;s page can set its own. A secret&apos;s value is
          never shown again once saved.
        </p>
        {draft.serverValues.map((value, index) => (
          // A value's name is what the user edits, so its place is its identity.
          <ServerValueFields
            key={index}
            value={value}
            saved={saved?.serverValues.find(({ name }) => name === value.name.trim())}
            change={(changed) => changeValue(index, changed)}
            remove={() => removeValue(index)}
          />
        ))}
      </div>
    </>
  );
}

function ServerValueFields({
  value,
  saved,
  change,
  remove,
}: {
  readonly value: ServerValueEdit;
  /** Undefined while no value of its name is kept. */
  readonly saved: ServerValue | undefined;
  readonly change: (value: ServerValueEdit) => void;
  readonly remove: () => void;
}): ReactNode {
  const called = value.name === "" ? "the new Server value" : `the Server value ${value.name}`;
  return (
    <fieldset className="server-value" aria-label={called}>
      <div className="server-value-fields">
        <Input
          label="Name"
          value={value.name}
          onChange={(event) => change({ ...value, name: event.target.value })}
          inputStyle={{ fontFamily: "var(--font-mono)" }}
        />
        {value.secret ? (
          <SecretValueInput
            label="Office-wide value"
            typed={value.officeWideValue}
            set={secretValueSet(saved)}
            change={(typed) => change(withSecretValue(value, typed))}
          />
        ) : (
          <Input
            label="Office-wide value"
            hint={value.officeWideValue === "" ? "No value is set." : undefined}
            value={value.officeWideValue ?? ""}
            onChange={(event) => change({ ...value, officeWideValue: event.target.value })}
          />
        )}
        <IconButton
          size="sm"
          icon={<Icon name="x" size={14} />}
          label={`Remove ${called}`}
          onClick={remove}
        />
      </div>
      <div className="server-value-flags">
        <Checkbox
          checked={value.secret}
          onChange={(secret) => change(withSecret(value, secret))}
          label="Secret"
        />
        <Checkbox
          checked={value.required}
          onChange={(required) => change({ ...value, required })}
          label="Required"
          description="Sessions leave the server out while it has no value"
        />
      </div>
    </fieldset>
  );
}
