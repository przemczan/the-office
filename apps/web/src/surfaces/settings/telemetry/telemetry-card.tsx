import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BUNDLED_GRAFANA_ENDPOINT,
  type BundledGrafanaStatus,
  type RunningTelemetry,
  type SavedTelemetryChoice,
  type TelemetryChoice,
  type TelemetrySettings,
} from "@the-office/contracts";
import {
  Alert,
  Badge,
  Button,
  Card,
  Icon,
  IconButton,
  Input,
  RadioList,
  type RadioListOption,
} from "@the-office/ui";
import { useId, useState, type ReactNode } from "react";
import {
  saveTelemetry,
  startBundledGrafana,
  TELEMETRY_SETTINGS,
  telemetryQueries,
} from "../../../api/telemetry.ts";
import { RefusalAlert } from "../../../shell/refusal-alert.tsx";
import { useToast } from "../../../shell/toasts.tsx";
import "./telemetry.css";

type Kind = TelemetryChoice["kind"];

/** One header row: a saved one keeps its value while `value` stays empty. */
interface HeaderRow {
  readonly key: number;
  readonly name: string;
  readonly value: string;
  readonly saved: boolean;
}

/** How often the card reads the settings again while the bundled Grafana starts. */
const STARTING_REFETCH_MILLISECONDS = 3_000;

const KIND_OPTIONS: readonly RadioListOption[] = [
  { value: "off", label: "Off: nothing is exported" },
  {
    value: "bundled-grafana",
    label: `Bundled Grafana, on this computer at ${BUNDLED_GRAFANA_ENDPOINT}`,
  },
  { value: "own-endpoint", label: "Your own endpoint, over OTLP/HTTP" },
];

/**
 * Where The Office exports its traces, metrics and logs: off, the bundled Grafana or the user's
 * own OTLP endpoint with its headers. A saved header's value never comes back: its row shows the
 * name, and an empty value keeps it. Read-only while the environment's OTEL_ variables set
 * telemetry. With Bundled Grafana saved, the bundled Grafana's state shows under the choice, read
 * again every few seconds while it starts. Settings › Telemetry and the First-run setup's
 * Telemetry step both show it.
 */
export function TelemetryCard({
  onSaved,
}: {
  /** Called with the saved settings, such as for the First-run setup to move on. */
  readonly onSaved?: (settings: TelemetrySettings) => void;
} = {}): ReactNode {
  const settings = useQuery({
    ...telemetryQueries.settings(),
    refetchInterval: (query) =>
      query.state.data?.bundledGrafana.state === "starting" ? STARTING_REFETCH_MILLISECONDS : false,
  });
  // Each save starts the form again from what was saved, even when the choice is the same.
  const [saves, setSaves] = useState(0);
  return (
    <Card
      title={
        <span className="telemetry-title">
          <Icon name="activity" size={15} strokeWidth={1.6} />
          Telemetry
        </span>
      }
      subtitle="Where The Office sends its traces, metrics and logs, for a dashboard such as Grafana."
    >
      <div className="telemetry-body">
        {settings.error && (
          <RefusalAlert title="The telemetry setting can't be read" error={settings.error} />
        )}
        {settings.data &&
          (settings.data.setByEnvironment ? (
            <SetByEnvironment running={settings.data.running} />
          ) : (
            // Keyed by what is saved, so the form starts again from it once saved.
            <TelemetryForm
              key={`${saves}:${JSON.stringify(settings.data.saved)}`}
              settings={settings.data}
              onSaved={(answer) => {
                setSaves((count) => count + 1);
                onSaved?.(answer);
              }}
            />
          ))}
      </div>
    </Card>
  );
}

function SetByEnvironment({ running }: { readonly running: RunningTelemetry }): ReactNode {
  return (
    <>
      <Alert tone="info" title="The environment sets telemetry">
        The OTEL_ variables in .env (or the environment The Office starts in) decide where it
        exports, so it can't be changed here. Remove them to choose here instead.
      </Alert>
      <p className="telemetry-note">{runningWords(running)}</p>
    </>
  );
}

function TelemetryForm({
  settings,
  onSaved,
}: {
  readonly settings: TelemetrySettings;
  readonly onSaved: (settings: TelemetrySettings) => void;
}): ReactNode {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const name = useId();
  const { saved } = settings;
  const ownSaved = saved.kind === "own-endpoint" ? saved : undefined;
  const [kind, setKind] = useState<Kind>(saved.kind);
  const [endpoint, setEndpoint] = useState(ownSaved?.endpoint ?? "");
  const [timeout, setTimeoutText] = useState(
    ownSaved?.timeoutMilliseconds === undefined ? "" : String(ownSaved.timeoutMilliseconds),
  );
  const [headers, setHeaders] = useState<readonly HeaderRow[]>(() => savedRows(ownSaved));
  const [nextKey, setNextKey] = useState(headers.length);
  const timeoutProblem =
    timeout.trim() !== "" && !/^[1-9]\d*$/.test(timeout.trim())
      ? "A whole number of milliseconds, or empty for 10 seconds."
      : undefined;
  const saving = useMutation({
    mutationFn: () => saveTelemetry(choiceOf(kind, endpoint, headers, timeout)),
    onSuccess: async (answer) => {
      queryClient.setQueryData(TELEMETRY_SETTINGS, answer);
      await queryClient.invalidateQueries({ queryKey: TELEMETRY_SETTINGS });
      showToast(savedToast(answer));
      onSaved(answer);
    },
  });
  const changeHeader = (key: number, change: Partial<HeaderRow>) =>
    setHeaders((rows) => rows.map((row) => (row.key === key ? { ...row, ...change } : row)));
  return (
    <form
      className="telemetry-form"
      aria-label="Telemetry"
      onSubmit={(event) => {
        event.preventDefault();
        if (!timeoutProblem) saving.mutate();
      }}
    >
      {saving.error && <RefusalAlert title="Telemetry wasn't saved" error={saving.error} />}
      <RadioList
        label="Where telemetry goes"
        name={`telemetry-${name}`}
        options={KIND_OPTIONS}
        value={kind}
        onChange={(value) => setKind(value as Kind)}
      />
      {saved.kind === "bundled-grafana" && settings.bundledGrafana.state !== "not-wanted" && (
        <BundledGrafanaState status={settings.bundledGrafana} />
      )}
      {kind === "own-endpoint" && (
        <div className="telemetry-endpoint">
          <Input
            label="Endpoint URL"
            autoComplete="off"
            spellCheck={false}
            placeholder="https://otlp.example.com"
            hint="The OTLP/HTTP base address: /v1/traces, /v1/metrics and /v1/logs are added to it."
            value={endpoint}
            onChange={(event) => setEndpoint(event.target.value)}
            required
          />
          <div className="telemetry-headers" role="group" aria-label="Headers">
            <span className="telemetry-subtitle">Headers</span>
            {headers.length === 0 && (
              <p className="telemetry-note">
                None. Add one when the endpoint needs a key, such as Authorization.
              </p>
            )}
            {headers.map((row, index) => (
              <div key={row.key} className="telemetry-header-row">
                <Input
                  label={`Header ${index + 1} name`}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="Authorization"
                  value={row.name}
                  onChange={(event) => changeHeader(row.key, { name: event.target.value })}
                />
                <Input
                  label={`Header ${index + 1} value`}
                  type="password"
                  autoComplete="off"
                  placeholder={row.saved ? "Saved" : undefined}
                  hint={row.saved ? "Saved, never shown. Leave it empty to keep it." : undefined}
                  value={row.value}
                  onChange={(event) => changeHeader(row.key, { value: event.target.value })}
                />
                <IconButton
                  size="sm"
                  icon={<Icon name="x" size={14} />}
                  label={`Remove the header ${row.name || index + 1}`}
                  onClick={() => setHeaders((rows) => rows.filter((each) => each.key !== row.key))}
                />
              </div>
            ))}
            <Button
              variant="secondary"
              size="sm"
              iconLeft={<Icon name="plus" size={14} />}
              onClick={() => {
                setHeaders((rows) => [
                  ...rows,
                  { key: nextKey, name: "", value: "", saved: false },
                ]);
                setNextKey((key) => key + 1);
              }}
            >
              Add a header
            </Button>
          </div>
          <Input
            label="Export timeout"
            inputMode="numeric"
            suffix="ms"
            placeholder="10000"
            hint={timeoutProblem ? undefined : "How long one export may take; empty is 10 seconds."}
            {...(timeoutProblem && { error: timeoutProblem })}
            value={timeout}
            onChange={(event) => setTimeoutText(event.target.value)}
          />
        </div>
      )}
      <p className="telemetry-note">{runningWords(settings.running)}</p>
      <div className="telemetry-actions">
        <span className="telemetry-actions-state">
          Applies the next time The Office starts.
          {settings.appliesAtNextStart && (
            <>
              {" "}
              <Badge tone="warning" size="sm">
                Saved, not running yet
              </Badge>
            </>
          )}
        </span>
        <Button variant="primary" size="sm" type="submit" loading={saving.isPending}>
          Save
        </Button>
      </div>
    </form>
  );
}

/**
 * The bundled Grafana's state while Bundled Grafana is saved: Starting…, Running with a link to
 * open it, or Couldn't start with the problem and Try again; and the earlier bundled Grafana The
 * Office stopped, if any.
 */
function BundledGrafanaState({ status }: { readonly status: BundledGrafanaStatus }): ReactNode {
  const queryClient = useQueryClient();
  const starting = useMutation({
    mutationFn: startBundledGrafana,
    onSuccess: (answer) => queryClient.setQueryData(TELEMETRY_SETTINGS, answer),
  });
  return (
    <div className="telemetry-grafana" role="group" aria-label="Bundled Grafana">
      {status.state === "starting" && (
        <Alert tone="info" title="Bundled Grafana: Starting…">
          The first start pulls its image, which can take a few minutes.
        </Alert>
      )}
      {status.state === "running" && (
        <Alert
          tone="success"
          title="Bundled Grafana: Running"
          action={
            <a className="telemetry-link" href={status.address} target="_blank" rel="noreferrer">
              Open Grafana
            </a>
          }
        >
          At {status.address}.
        </Alert>
      )}
      {status.state === "failed" && (
        <Alert
          tone="danger"
          title="Bundled Grafana: Couldn't start"
          action={
            <Button
              variant="secondary"
              size="sm"
              loading={starting.isPending}
              disabled={starting.isPending}
              onClick={() => starting.mutate()}
            >
              Try again
            </Button>
          }
        >
          {status.problem ?? "The Office couldn't start it."}
        </Alert>
      )}
      {starting.error && (
        <RefusalAlert title="The bundled Grafana wasn't started" error={starting.error} />
      )}
      {status.earlierStopped.length > 0 && (
        <p className="telemetry-note">
          The Office stopped the earlier bundled Grafana ({status.earlierStopped.join(", ")}) to
          start its own; it was kept, not removed.
        </p>
      )}
    </div>
  );
}

/** The saved toast: with Bundled Grafana, that it starts now, and when the exporters switch to it. */
function savedToast(answer: TelemetrySettings): string {
  if (answer.saved.kind !== "bundled-grafana") {
    return "Telemetry was saved: it applies the next time The Office starts.";
  }
  return answer.appliesAtNextStart
    ? "Telemetry was saved: the bundled Grafana is starting, and The Office exports to it from its next start."
    : "Telemetry was saved: the bundled Grafana is starting.";
}

function savedRows(saved: Extract<SavedTelemetryChoice, { kind: "own-endpoint" }> | undefined) {
  return (saved?.headerNames ?? []).map((name, key): HeaderRow => ({
    key,
    name,
    value: "",
    saved: true,
  }));
}

/** What Save sends: rows with neither a name nor a value are left out. */
function choiceOf(
  kind: Kind,
  endpoint: string,
  headers: readonly HeaderRow[],
  timeout: string,
): TelemetryChoice {
  if (kind !== "own-endpoint") return { kind };
  const milliseconds = timeout.trim() === "" ? undefined : Number(timeout.trim());
  return {
    kind,
    endpoint: endpoint.trim(),
    headers: headers
      .filter((row) => row.name.trim() !== "" || row.value !== "")
      .map((row) => ({ name: row.name.trim(), value: row.value })),
    ...(milliseconds !== undefined && { timeoutMilliseconds: milliseconds }),
  };
}

function runningWords(running: RunningTelemetry): string {
  return running.kind === "off"
    ? "Now: telemetry is off."
    : `Now: exporting to ${running.endpoint}.`;
}
