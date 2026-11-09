import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CpuLimitChange, CpuLimitChoice, RunEnvironmentCpuLimit } from "@the-office/contracts";
import { Card, SegmentedControl, Stepper } from "@the-office/ui";
import type { ReactNode } from "react";
import { changeCpuLimit, cpuLimitQuery } from "../../../api/run-environments.ts";
import { SettingsCardTitle, SettingsProblem } from "../settings-card-parts.tsx";

const CHOICES: readonly { readonly value: CpuLimitChoice; readonly label: string }[] = [
  { value: "automatic", label: "Automatic" },
  { value: "fixed", label: "Fixed" },
];

/** Settings › Office limits: the CPU limit every run environment's services get. */
export function RunEnvironmentsCard(): ReactNode {
  const queryClient = useQueryClient();
  const cpuLimit = useQuery(cpuLimitQuery());
  const saving = useMutation({
    mutationFn: changeCpuLimit,
    onSuccess: (saved) => queryClient.setQueryData(cpuLimitQuery().queryKey, saved),
  });
  const shown = cpuLimit.data;
  return (
    <Card title={<SettingsCardTitle icon="cpu">Run environments</SettingsCardTitle>}>
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
                if (saving.isPending || choice === shown.cpuLimit) return;
                saving.mutate(changeTo(shown, choice === "fixed" ? "fixed" : "automatic"));
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
                onChange={(fixedCpus) => saving.mutate({ cpuLimit: "fixed", fixedCpus })}
              />
            )}
          </div>
        )}
      </div>
      <p className="settings-note stepper-note">
        A change applies from each run environment&apos;s next start; running ones keep their limit.
      </p>
      <SettingsProblem title="The CPU limit can't be read" error={cpuLimit.error} />
      <SettingsProblem title="The CPU limit can't be saved" error={saving.error} />
    </Card>
  );
}

/** The saved fixed number, within this computer's cores, which it may have outgrown. */
function changeTo(shown: RunEnvironmentCpuLimit, choice: CpuLimitChoice): CpuLimitChange {
  return { cpuLimit: choice, fixedCpus: Math.min(shown.fixedCpus, shown.hostCores) };
}

function automaticWords({ hostCores, automatic }: RunEnvironmentCpuLimit): string {
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
