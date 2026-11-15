import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import type { EngineSettings, FirstRunSetup } from "@the-office/contracts";
import { Button, Card, useAppearance } from "@the-office/ui";
import type { ReactNode } from "react";
import { engineSettingsQuery } from "../../../api/engine.ts";
import { closeFirstRunSetup, FIRST_RUN_SETUP } from "../../../api/users.ts";
import { OfficeMark } from "../../../shell/office-mark.tsx";
import { RefusalAlert } from "../../../shell/refusal-alert.tsx";
import { ClaudeCodeEngineAccount } from "../engines/claude-code-engine-account.tsx";
import { GitHubCard } from "../office-identity/github-card.tsx";
import { SettingsCardTitle, SettingsProblem } from "../settings-card-parts.tsx";
import { TelemetryCard } from "../telemetry/telemetry-card.tsx";
import {
  FIRST_RUN_SETUP_STEP_NAMES,
  FIRST_RUN_SETUP_STEPS,
  stepAfter,
  type FirstRunSetupStep,
} from "./first-run-setup-steps.ts";
import "../settings.css";
import "../engines/engines.css";
import "../office-identity/office-identity.css";
import "./first-run-setup.css";

const CLOSED: FirstRunSetup = { basics: "closed" };

/** What each step is for, under its heading. */
const STEP_LEADS: Readonly<Record<FirstRunSetupStep, string>> = {
  engine:
    "The engine runs the sessions of The Office's people. Sign the Office default engine in now, or later in Settings › Engines.",
  github:
    "The Office's own git identity for GitHub over https: cloning, pushing and pull requests on the repositories its App is installed on. Skip it when your Projects aren't on GitHub; Settings › Office identity has it later.",
  telemetry:
    "Where The Office sends its traces, metrics and logs. Saving the choice finishes the setup; Settings › Telemetry changes it later.",
};

/**
 * First-run setup (`/setup?step=`), signed in but outside the shell: after the first user, the
 * basics one step at a time, each skippable: the Office default engine's sign-in, Sign in with
 * GitHub, telemetry. Finish, Skip the rest, or saving telemetry on the last step closes it for good
 * and goes to Now; while it is open, every signed-in page comes here (`RootLayout`).
 */
export function FirstRunSetupPage(): ReactNode {
  const { step = "engine" } = useSearch({ from: "/setup" });
  const navigate = useNavigate({ from: "/setup" });
  const queryClient = useQueryClient();
  const { base } = useAppearance();
  const closing = useMutation({
    mutationFn: closeFirstRunSetup,
    onSuccess: async () => {
      // Closed before leaving, so Now doesn't send the browser back here.
      queryClient.setQueryData(FIRST_RUN_SETUP, CLOSED);
      await navigate({ to: "/now", replace: true });
      await queryClient.invalidateQueries({ queryKey: FIRST_RUN_SETUP });
    },
  });
  const next = stepAfter(step);
  const position = FIRST_RUN_SETUP_STEPS.indexOf(step) + 1;
  const goOn = (): void => {
    if (next === undefined) closing.mutate();
    else void navigate({ search: { step: next } });
  };
  const headingId = `first-run-setup-${step}`;
  return (
    <main className="first-run-setup-page">
      <div className="first-run-setup-column">
        <div className="first-run-setup-office">
          <OfficeMark size={28} tone={base} />
          <span>The Office</span>
        </div>
        <h1>First-run setup</h1>
        <p className="first-run-setup-lead">
          A few basics before work starts. Each one can be skipped and set up later in Settings.
        </p>
        <ol className="first-run-setup-steps" aria-label="Steps">
          {FIRST_RUN_SETUP_STEPS.map((each, index) => (
            <li
              key={each}
              className="first-run-setup-step"
              {...(each === step && { "aria-current": "step" as const })}
            >
              <span className="first-run-setup-step-number" aria-hidden>
                {index + 1}
              </span>
              {FIRST_RUN_SETUP_STEP_NAMES[each]}
            </li>
          ))}
        </ol>
        <section className="first-run-setup-body" aria-labelledby={headingId}>
          <div className="first-run-setup-heading">
            <span className="first-run-setup-position">
              Step {position} of {FIRST_RUN_SETUP_STEPS.length}
            </span>
            <h2 id={headingId}>{FIRST_RUN_SETUP_STEP_NAMES[step]}</h2>
            <p className="first-run-setup-lead">{STEP_LEADS[step]}</p>
          </div>
          {step === "engine" && <EngineStep />}
          {step === "github" && <GitHubCard />}
          {step === "telemetry" && <TelemetryCard onSaved={() => closing.mutate()} />}
        </section>
        {closing.error && (
          <RefusalAlert title="First-run setup wasn't closed" error={closing.error} />
        )}
        <div className="first-run-setup-actions">
          {next !== undefined && (
            <Button variant="ghost" disabled={closing.isPending} onClick={() => closing.mutate()}>
              Skip the rest
            </Button>
          )}
          <span className="first-run-setup-actions-gap" />
          <Button variant="secondary" disabled={closing.isPending} onClick={goOn}>
            Skip
          </Button>
          <Button variant="primary" loading={closing.isPending} onClick={goOn}>
            {next === undefined ? "Finish" : "Next"}
          </Button>
        </div>
      </div>
    </main>
  );
}

/**
 * The Office default engine's sign-in when it is a Claude Code engine; an API engine is set up in
 * Settings › Engines, which the step links to.
 */
function EngineStep(): ReactNode {
  const settings = useQuery(engineSettingsQuery());
  const engine = settings.data && officeDefaultEngineOf(settings.data);
  return (
    <Card title={<SettingsCardTitle icon="cpu">Office default engine</SettingsCardTitle>}>
      <div className="first-run-setup-card-body">
        {settings.isPending && <p className="settings-note">Reading the engines…</p>}
        {settings.data && engine === undefined && (
          <p className="settings-note">
            No engine is the Office default yet, so no session starts. Add one in{" "}
            <Link className="first-run-setup-link" to="/settings/engines">
              Settings › Engines
            </Link>
            .
          </p>
        )}
        {engine?.kind === "claude-code" && (
          <>
            <p className="settings-note">
              {engine.name}, a Claude Code engine. Sign it in with a Claude account, or paste a
              token made with <code>claude setup-token</code>.
            </p>
            <ClaudeCodeEngineAccount engineId={engine.id} />
          </>
        )}
        {engine?.kind === "openai-compatible-api" && (
          <p className="settings-note">
            {engine.name}, an API endpoint of the OpenAI-compatible API. Its address, key and models
            are set in{" "}
            <Link className="first-run-setup-link" to="/settings/engines">
              Settings › Engines
            </Link>
            .
          </p>
        )}
        <SettingsProblem title="The engines' settings can't be read" error={settings.error} />
      </div>
    </Card>
  );
}

/** The engine the Office default names, among the saved ones. */
function officeDefaultEngineOf(
  settings: EngineSettings,
): EngineSettings["engines"][number] | undefined {
  const engineId = settings.officeDefault?.engineId;
  return settings.engines.find(({ id }) => id === engineId);
}
