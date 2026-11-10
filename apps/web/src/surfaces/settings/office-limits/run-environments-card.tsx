import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  gigabytesOf,
  MEMORY_PER_SERVICE_MEGABYTES,
  PROCESSES_PER_SERVICE,
  RUN_ENVIRONMENTS_AT_ONCE,
  type CpuLimitChoice,
  type RunEnvironmentOfficeLimits,
  type RunEnvironmentOfficeLimitsChange,
} from "@the-office/contracts";
import { Alert, Card, SegmentedControl, Stepper } from "@the-office/ui";
import type { ReactNode } from "react";
import {
  changeRunEnvironmentOfficeLimits,
  runEnvironmentOfficeLimitsQuery,
} from "../../../api/run-environments.ts";
import { officeWideLimitQuery } from "../../../api/work.ts";
import { SettingsCardTitle, SettingsProblem } from "../settings-card-parts.tsx";

const CHOICES: readonly { readonly value: CpuLimitChoice; readonly label: string }[] = [
  { value: "automatic", label: "Automatic" },
  { value: "fixed", label: "Fixed" },
];

/**
 * Settings › Office limits: Run environments at once, and the CPUs, memory and processes every
 * run environment's services get. Each change saves the whole set with its one value changed.
 */
export function RunEnvironmentsCard(): ReactNode {
  const queryClient = useQueryClient();
  const officeLimits = useQuery(runEnvironmentOfficeLimitsQuery());
  const officeWideLimit = useQuery(officeWideLimitQuery());
  const saving = useMutation({
    mutationFn: changeRunEnvironmentOfficeLimits,
    onSuccess: (saved) =>
      queryClient.setQueryData(runEnvironmentOfficeLimitsQuery().queryKey, saved),
  });
  const shown = officeLimits.data;
  const save = (changed: Partial<RunEnvironmentOfficeLimitsChange>): void => {
    if (shown === undefined || saving.isPending) return;
    saving.mutate({ ...changeOf(shown), ...changed });
  };
  const runningTasksAtOnce = officeWideLimit.data?.officeWideLimit;
  return (
    <Card title={<SettingsCardTitle icon="cpu">Run environments</SettingsCardTitle>}>
      <div className="run-environment-limits">
        <div className="stepper-row">
          <div className="stepper-row-words">
            <b>Run environments at once</b>
            <p className="settings-note">
              How many may be running together; a Stage past them waits for one to stop.
            </p>
          </div>
          {shown && (
            <Stepper
              label="run environments at once"
              value={shown.runEnvironmentsAtOnce}
              min={RUN_ENVIRONMENTS_AT_ONCE.min}
              max={RUN_ENVIRONMENTS_AT_ONCE.max}
              step={RUN_ENVIRONMENTS_AT_ONCE.step}
              disabled={saving.isPending}
              onChange={(runEnvironmentsAtOnce) => save({ runEnvironmentsAtOnce })}
            />
          )}
        </div>
        <div className="stepper-row">
          <div className="stepper-row-words">
            <b>CPUs per run environment</b>
            {shown && <p className="settings-note">{automaticWords(shown)}</p>}
          </div>
          {shown && (
            <div className="cpu-limit-controls">
              <SegmentedControl
                size="sm"
                options={[...CHOICES]}
                value={shown.cpuLimit}
                onChange={(choice) => {
                  if (choice === shown.cpuLimit) return;
                  save({ cpuLimit: choice === "fixed" ? "fixed" : "automatic" });
                }}
              />
              {shown.cpuLimit === "fixed" && (
                <Stepper
                  label="the CPUs per service"
                  value={shown.fixedCpus}
                  min={1}
                  max={shown.hostCores}
                  format={cpusWords}
                  disabled={saving.isPending}
                  onChange={(fixedCpus) => save({ fixedCpus })}
                />
              )}
            </div>
          )}
        </div>
        <div className="stepper-row">
          <div className="stepper-row-words">
            <b>Memory per service</b>
            <p className="settings-note">The most memory each service may use, with no swap.</p>
          </div>
          {shown && (
            <Stepper
              label="the memory per service"
              value={shown.memoryMegabytes}
              min={MEMORY_PER_SERVICE_MEGABYTES.min}
              max={MEMORY_PER_SERVICE_MEGABYTES.max}
              step={MEMORY_PER_SERVICE_MEGABYTES.step}
              format={gigabytesOf}
              disabled={saving.isPending}
              onChange={(memoryMegabytes) => save({ memoryMegabytes })}
            />
          )}
        </div>
        <div className="stepper-row">
          <div className="stepper-row-words">
            <b>Processes per service</b>
            <p className="settings-note">The most processes each service may run at once.</p>
          </div>
          {shown && (
            <Stepper
              label="the processes per service"
              value={shown.processes}
              min={PROCESSES_PER_SERVICE.min}
              max={PROCESSES_PER_SERVICE.max}
              step={PROCESSES_PER_SERVICE.step}
              disabled={saving.isPending}
              onChange={(processes) => save({ processes })}
            />
          )}
        </div>
      </div>
      <p className="settings-note stepper-note">
        A change applies from each run environment&apos;s next start; running ones keep their
        limits. Raising Run environments at once lets a waiting Stage start at once.
      </p>
      {shown &&
        runningTasksAtOnce !== undefined &&
        shown.runEnvironmentsAtOnce < runningTasksAtOnce && (
          <div className="settings-banner">
            <Alert tone="warning" title="Fewer run environments than running Tasks">
              Running Tasks past {shown.runEnvironmentsAtOnce} wait on their checks: they show
              &ldquo;Waiting for a run environment&rdquo; until one stops.
            </Alert>
          </div>
        )}
      <SettingsProblem
        title="The run environments' limits can't be read"
        error={officeLimits.error}
      />
      <SettingsProblem title="The run environments' limits can't be saved" error={saving.error} />
    </Card>
  );
}

/** What PUT takes from what GET gave: a saved fixed number is held to this computer's cores. */
function changeOf(shown: RunEnvironmentOfficeLimits): RunEnvironmentOfficeLimitsChange {
  return {
    runEnvironmentsAtOnce: shown.runEnvironmentsAtOnce,
    cpuLimit: shown.cpuLimit,
    fixedCpus: Math.min(shown.fixedCpus, shown.hostCores),
    memoryMegabytes: shown.memoryMegabytes,
    processes: shown.processes,
  };
}

function automaticWords({ hostCores, automatic }: RunEnvironmentOfficeLimits): string {
  return (
    `Automatic follows this computer's cores: the checks get ${automatic.checksCpus} of its ` +
    `${hostCores}, Postgres and other services ${automatic.otherServicesCpus} each. Every run ` +
    "environment gets the same, so one running Task can use the idle cores and two share them. " +
    "Fixed gives every service one number."
  );
}

function cpusWords(cpus: number): string {
  return cpus === 1 ? "1 CPU" : `${cpus} CPUs`;
}
