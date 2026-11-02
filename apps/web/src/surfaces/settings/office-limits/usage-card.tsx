import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { EngineId, Now, UsageSettings } from "@the-office/contracts";
import { Button, Card, Checkbox, Input } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { nowQueries } from "../../../api/notifications.ts";
import { changeUsageSettings, usageSettingsQuery } from "../../../api/work.ts";
import { resetWords } from "../../../shell/notifications/now-words.ts";
import { RefusalAlert } from "../../../shell/refusal-alert.tsx";
import { useToast } from "../../../shell/toasts.tsx";
import { useEngineName } from "../../../shell/use-engine-name.ts";
import { MEASURE_LABELS, MEASURES } from "../../../shell/work/usage-estimate-words.ts";
import { SettingsCardTitle, SettingsProblem } from "../settings-card-parts.tsx";
import {
  capFieldProblem,
  capTextOf,
  draftChanged,
  draftOf,
  usageSettingsOf,
  withCapText,
  withMeasure,
  type CapKind,
  type CapsText,
  type UsageSettingsDraft,
} from "./usage-settings-draft.ts";

const CAP_FIELDS: Readonly<Record<CapKind, { label: string; suffix: string }>> = {
  fiveHour: { label: "5-hour window", suffix: "%" },
  sevenDay: { label: "7-day window", suffix: "%" },
  dailyTokens: { label: "Tokens a day", suffix: "tokens" },
  dailyDollars: { label: "Dollars a day", suffix: "$" },
};

/** Settings › Office limits' Usage: the measures a Usage estimate is given in, and the caps. */
export function UsageCard(): ReactNode {
  const settings = useQuery(usageSettingsQuery());
  return (
    <>
      {settings.data && <UsageSettingsForm saved={settings.data} />}
      <SettingsProblem title="The usage settings can't be read" error={settings.error} />
    </>
  );
}

function UsageSettingsForm({ saved }: { readonly saved: UsageSettings }): ReactNode {
  const [draft, setDraft] = useState<UsageSettingsDraft>(() => draftOf(saved));
  const dirty = draftChanged(draft, saved);
  const toSave = usageSettingsOf(draft);
  const queryClient = useQueryClient();
  const showToast = useToast();
  const saving = useMutation({
    mutationFn: changeUsageSettings,
    onSuccess: (result) => {
      queryClient.setQueryData(usageSettingsQuery().queryKey, result);
      setDraft(draftOf(result));
      showToast("Usage saved. The queue is weighed against the caps again.");
    },
  });
  return (
    <Card title={<SettingsCardTitle icon="battery-medium">Usage</SettingsCardTitle>}>
      <fieldset className="usage-measures">
        <legend>
          <b>Usage estimates in</b>
        </legend>
        <p className="settings-note">
          A Ready Task shows what its Pipeline is expected to use in each ticked measure. With none
          ticked, no estimate is made.
        </p>
        <div className="usage-measure-boxes">
          {MEASURES.map((measure) => (
            <Checkbox
              key={measure}
              label={MEASURE_LABELS[measure]}
              checked={draft.measures.includes(measure)}
              onChange={(ticked) => setDraft(withMeasure(draft, measure, ticked))}
            />
          ))}
        </div>
      </fieldset>
      <p className="settings-note usage-caps-note">
        A Start that would pass a cap, with its Usage estimate, waits in the queue until the cap
        resets, unless every cap it would pass resets within the hour. A field left empty is no cap.
      </p>
      {draft.caps.map((caps) => (
        <EngineCapsFields
          key={caps.engineId}
          caps={caps}
          change={(kind, text) => setDraft(withCapText(draft, caps.engineId, kind, text))}
        />
      ))}
      {saving.error && (
        <RefusalAlert title="The usage settings weren't saved" error={saving.error} />
      )}
      <div className="settings-actions usage-actions">
        <span className="settings-actions-state">{dirty ? "Unsaved changes" : "Saved"}</span>
        <Button variant="secondary" disabled={!dirty} onClick={() => setDraft(draftOf(saved))}>
          Discard
        </Button>
        <Button
          loading={saving.isPending}
          // A cap's field shows what holds it.
          disabled={!dirty || toSave === undefined}
          onClick={() => toSave && saving.mutate(toSave)}
        >
          Save
        </Button>
      </div>
    </Card>
  );
}

function EngineCapsFields({
  caps,
  change,
}: {
  readonly caps: CapsText;
  readonly change: (kind: CapKind, text: string) => void;
}): ReactNode {
  const name = useEngineName()(caps.engineId);
  const field = (kind: CapKind): ReactNode => (
    <Input
      label={CAP_FIELDS[kind].label}
      inputMode="decimal"
      suffix={CAP_FIELDS[kind].suffix}
      value={capTextOf(caps, kind)}
      error={capFieldProblem(kind, capTextOf(caps, kind))}
      onChange={(event) => change(kind, event.target.value)}
    />
  );
  return (
    <section className="usage-engine" aria-label={name}>
      <h3 className="usage-engine-name">{name}</h3>
      {caps.windows && (
        <>
          <WindowsUse engineId={caps.engineId} />
          <fieldset className="usage-caps" aria-label={`${name}'s window caps`}>
            <span className="usage-caps-kind">Window caps</span>
            {field("fiveHour")}
            {field("sevenDay")}
          </fieldset>
        </>
      )}
      <fieldset className="usage-caps" aria-label={`${name}'s daily caps`}>
        <span className="usage-caps-kind">Daily caps</span>
        {field("dailyTokens")}
        {field("dailyDollars")}
      </fieldset>
    </section>
  );
}

/**
 * The engine's 5-hour window as it last read it, as the status strip shows it; Now carries no
 * 7-day window.
 */
function WindowsUse({ engineId }: { readonly engineId: EngineId }): ReactNode {
  const now = useQuery(nowQueries.now());
  if (!now.data) return null;
  const fiveHour = now.data.fiveHourWindows.find((each) => each.engineId === engineId);
  return <p className="settings-note">{fiveHourWords(fiveHour)}</p>;
}

function fiveHourWords(fiveHour: Now["fiveHourWindows"][number] | undefined): string {
  if (!fiveHour) return "The 5-hour window hasn't been read yet: it is read as each Stage runs.";
  const resets = resetWords(fiveHour.resetsAt);
  return `The 5-hour window: ${Math.round(fiveHour.percentUsed)}% used${resets ? ` · ${resets}` : ""}`;
}
