import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  IDLE_TIME_MINUTES,
  TEST_INSTANCES_AT_ONCE,
  type TestInstanceSettings,
} from "@the-office/contracts";
import { Alert, Card, Input, Stepper } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { changeTestInstanceSettings, testInstanceQueries } from "../../../api/test-instances.ts";
import { SettingsCardTitle, SettingsProblem } from "../settings-card-parts.tsx";
import {
  idleWords,
  portCountWords,
  portDraftsOf,
  problemsOfRefusal,
  settingsWithPorts,
  type PortDrafts,
  type SettingsProblem as Problem,
} from "./test-instance-settings-draft.ts";

/** Idle time steps by 5 minutes. */
const IDLE_STEP = 5;

/**
 * Settings › Office limits: Test instances at once, Idle time and the Proxy ports (spec
 * screens/settings.md, "Office limits"). Each change sends the whole set: a stepper at each step, a
 * port when its field loses focus or on Enter. A refusal shows under the card, naming the field,
 * which it marks.
 */
export function TestInstancesCard(): ReactNode {
  const queryClient = useQueryClient();
  const read = useQuery(testInstanceQueries.settings());
  const [problems, setProblems] = useState<readonly Problem[]>([]);
  // The ports as typed, until saved; undefined follows what the service has.
  const [typedPorts, setTypedPorts] = useState<PortDrafts>();
  const saving = useMutation({
    mutationFn: changeTestInstanceSettings,
    onSuccess: (saved) => {
      queryClient.setQueryData(testInstanceQueries.settings().queryKey, saved);
      setProblems([]);
      setTypedPorts(undefined);
    },
    onError: (error) => setProblems(problemsOfRefusal(error.message)),
  });
  const shown = read.data;
  const save = (settings: TestInstanceSettings): void => {
    if (!saving.isPending) saving.mutate(settings);
  };
  const ports = typedPorts ?? (shown && portDraftsOf(shown));
  const savePorts = (): void => {
    if (shown === undefined || typedPorts === undefined) return;
    const asked = settingsWithPorts(shown, typedPorts);
    if (asked === undefined) {
      setTypedPorts(undefined);
      setProblems([]);
    } else if ("problems" in asked) {
      setProblems(asked.problems);
    } else {
      save(asked.settings);
    }
  };
  const marked = (field: Problem["field"]): boolean =>
    problems.some((problem) => problem.field === field);
  const count = ports && portCountWords(ports);
  return (
    <Card title={<SettingsCardTitle icon="flask-conical">Test instances</SettingsCardTitle>}>
      <div className="run-environment-limits">
        <div className="stepper-row">
          <div className="stepper-row-words">
            <b>Test instances at once</b>
            <p className="settings-note">
              How many may be Building or Running together across The Office. Building counts.
              Counted apart from run environments.
            </p>
          </div>
          {shown && (
            <Stepper
              label="test instances at once"
              value={shown.testInstancesAtOnce}
              min={TEST_INSTANCES_AT_ONCE.min}
              max={TEST_INSTANCES_AT_ONCE.max}
              disabled={saving.isPending}
              onChange={(testInstancesAtOnce) => save({ ...shown, testInstancesAtOnce })}
            />
          )}
        </div>
        <div className="stepper-row">
          <div className="stepper-row-words">
            <b>Idle time</b>
            <p className="settings-note">
              A running test instance stops after this long with no request.
            </p>
          </div>
          {shown && (
            <Stepper
              label="the Idle time"
              value={shown.idleMinutes}
              min={IDLE_TIME_MINUTES.min}
              max={IDLE_TIME_MINUTES.max}
              step={IDLE_STEP}
              format={idleWords}
              disabled={saving.isPending}
              onChange={(idleMinutes) => save({ ...shown, idleMinutes })}
            />
          )}
        </div>
        <div className="stepper-row">
          <div className="stepper-row-words">
            <b>Proxy ports</b>
            <p className="settings-note">
              Each running test instance is opened at one of these ports on{" "}
              {window.location.hostname}. To reach them from another device on your network, The
              Office must listen on its LAN address and its firewall must let these ports in.
            </p>
          </div>
          {ports && (
            <div className="proxy-ports">
              <PortField
                label="First proxy port"
                value={ports.first}
                marked={marked("firstProxyPort")}
                disabled={saving.isPending}
                onType={(first) => setTypedPorts({ ...ports, first })}
                onDone={savePorts}
              />
              <span aria-hidden="true">–</span>
              <PortField
                label="Last proxy port"
                value={ports.last}
                marked={marked("lastProxyPort")}
                disabled={saving.isPending}
                onType={(last) => setTypedPorts({ ...ports, last })}
                onDone={savePorts}
              />
              <span className="proxy-ports-count">{problems.length === 0 ? count : undefined}</span>
            </div>
          )}
        </div>
      </div>
      <p className="settings-note stepper-note">
        Running instances keep their port. Lowering Test instances at once stops none: the next
        launch waits until fewer are running.
      </p>
      {problems.length > 0 && (
        <div className="settings-banner">
          <Alert tone="danger" title="The test instances' limits can't be saved">
            {problems.map(({ words }) => (
              <p key={words}>{words}</p>
            ))}
          </Alert>
        </div>
      )}
      <SettingsProblem title="The test instances' limits can't be read" error={read.error} />
    </Card>
  );
}

/**
 * A Proxy port's field, saved when it loses focus or on Enter; marked when a refusal names it. Its
 * blur is heard around it, so the design system's own focus ring still goes.
 */
function PortField({
  label,
  value,
  marked,
  disabled,
  onType,
  onDone,
}: {
  readonly label: string;
  readonly value: string;
  readonly marked: boolean;
  readonly disabled: boolean;
  readonly onType: (typed: string) => void;
  readonly onDone: () => void;
}): ReactNode {
  return (
    <span className="proxy-port" onBlur={onDone}>
      <Input
        size="sm"
        inputMode="numeric"
        aria-label={label}
        aria-invalid={marked}
        value={value}
        disabled={disabled}
        style={marked ? { width: 84, borderColor: "var(--danger)" } : { width: 84 }}
        onChange={(event) => onType(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") onDone();
        }}
      />
    </span>
  );
}
