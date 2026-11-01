import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import {
  GITHUB_APP_REGISTRATION_FAILED_PARAMETER,
  GITHUB_SIGN_IN_FAILED_PARAMETER,
  type GitHubAppManifestForm,
  type GitHubState,
} from "@the-office/contracts";
import { Alert, Badge, Button, Card, Icon } from "@the-office/ui";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  gitHubAppManifestForm,
  gitHubQueries,
  signOutOfGitHub,
  startGitHubSignIn,
} from "../../../api/github.ts";
import { RefusalAlert } from "../../../shell/refusal-alert.tsx";
import { SettingsCardTitle, SettingsProblem } from "../settings-card-parts.tsx";

const SECTION_PATH = "/settings/office-identity";

/** Sign in with GitHub: registering the GitHub App, then signing in and out through GitHub's page. */
export function GitHubCard(): ReactNode {
  const state = useQuery(gitHubQueries.state());
  return (
    <Card title={<SettingsCardTitle icon="github">Sign in with GitHub</SettingsCardTitle>}>
      <div className="office-identity-card-body">
        <ReturnFailures />
        {state.data && <GitHubStateView state={state.data} />}
        <SettingsProblem title="Sign in with GitHub can't be read" error={state.error} />
      </div>
    </Card>
  );
}

/** Why registering or signing in failed, as GitHub's return to The Office said; dismissed by the user. */
function ReturnFailures(): ReactNode {
  const search = useSearch({ from: SECTION_PATH });
  const navigate = useNavigate({ from: SECTION_PATH });
  const dismiss = (parameter: keyof typeof search) => (): void => {
    const { [parameter]: _dismissed, ...rest } = search;
    void navigate({ search: rest, replace: true });
  };
  const registrationFailed = search[GITHUB_APP_REGISTRATION_FAILED_PARAMETER];
  const signInFailed = search[GITHUB_SIGN_IN_FAILED_PARAMETER];
  return (
    <>
      {registrationFailed !== undefined && (
        <Alert
          tone="danger"
          title="The GitHub App wasn't registered"
          onClose={dismiss(GITHUB_APP_REGISTRATION_FAILED_PARAMETER)}
        >
          {registrationFailed}
        </Alert>
      )}
      {signInFailed !== undefined && (
        <Alert
          tone="danger"
          title="Signing in with GitHub failed"
          onClose={dismiss(GITHUB_SIGN_IN_FAILED_PARAMETER)}
        >
          {signInFailed}
        </Alert>
      )}
    </>
  );
}

function GitHubStateView({ state }: { readonly state: GitHubState }): ReactNode {
  switch (state.status) {
    case "not-registered":
      return <RegisterApp />;
    case "signed-out":
      return (
        <>
          <p className="settings-note">
            The GitHub App {state.app.slug} is registered on {state.app.owner}. Signing in lets The
            Office clone, fetch and push GitHub repositories over https and open pull requests, only
            on the repositories the App is installed on.
          </p>
          {state.reason && (
            <Alert tone="warning" title="The Office signed you out">
              {state.reason.text}
            </Alert>
          )}
          <div className="office-identity-row">
            <SignInButton />
            <InstallLink installUrl={state.app.installUrl}>
              Install the App on repositories
            </InstallLink>
          </div>
        </>
      );
    case "signed-in":
      return (
        <>
          <div className="office-identity-row">
            <span>Signed in as</span>
            <Badge tone="success" dot>
              {state.login}
            </Badge>
            <SignOutButton />
          </div>
          <p className="settings-note">
            Through the GitHub App {state.app.slug}, registered on {state.app.owner}. The Office
            reaches only the repositories it is installed on.
          </p>
          <InstallLink installUrl={state.app.installUrl}>
            Install the App on more repositories
          </InstallLink>
        </>
      );
  }
}

/**
 * Registering the App by its manifest: the browser itself posts the manifest form to GitHub, which
 * asks the user to name the App and sends the browser back to The Office.
 */
function RegisterApp(): ReactNode {
  const formRef = useRef<HTMLFormElement>(null);
  const [form, setForm] = useState<GitHubAppManifestForm>();
  const reading = useMutation({ mutationFn: gitHubAppManifestForm, onSuccess: setForm });
  useEffect(() => {
    if (form) formRef.current?.submit();
  }, [form]);
  return (
    <>
      <p className="settings-note">
        The Office signs in to GitHub through a GitHub App you register on your account. GitHub
        shows what it asks for and lets you name it, then sends you back here. It asks for:
      </p>
      <ul className="office-identity-permissions">
        <li>Metadata: read</li>
        <li>Contents, Pull requests and Workflows: read and write</li>
      </ul>
      <p className="settings-note">
        It has no webhook, and its tokens expire. Next, install it on the repositories The Office
        may reach, then sign in.
      </p>
      {reading.error && (
        <RefusalAlert title="The App's manifest can't be read" error={reading.error} />
      )}
      <div>
        <Button
          iconLeft={<Icon name="github" size={14} />}
          loading={reading.isPending || form !== undefined}
          onClick={() => reading.mutate()}
        >
          Register the GitHub App
        </Button>
      </div>
      {form && (
        <form ref={formRef} method="post" action={form.action} hidden>
          <input type="hidden" name="manifest" value={form.manifest} />
        </form>
      )}
    </>
  );
}

/** Sends the browser to GitHub's authorize page, which sends it back to The Office. */
function SignInButton(): ReactNode {
  const signingIn = useMutation({
    mutationFn: startGitHubSignIn,
    onSuccess: ({ authorizeUrl }) => window.location.assign(authorizeUrl),
  });
  return (
    <>
      <Button
        variant="accent"
        iconLeft={<Icon name="github" size={14} />}
        loading={signingIn.isPending || signingIn.isSuccess}
        onClick={() => signingIn.mutate()}
      >
        Sign in with GitHub
      </Button>
      {signingIn.error && <RefusalAlert title="Signing in can't start" error={signingIn.error} />}
    </>
  );
}

function SignOutButton(): ReactNode {
  const queryClient = useQueryClient();
  const signingOut = useMutation({
    mutationFn: signOutOfGitHub,
    onSuccess: () => queryClient.invalidateQueries(gitHubQueries.state()),
  });
  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        loading={signingOut.isPending}
        onClick={() => signingOut.mutate()}
      >
        Sign out
      </Button>
      {signingOut.error && <RefusalAlert title="You weren't signed out" error={signingOut.error} />}
    </>
  );
}

function InstallLink({
  installUrl,
  children,
}: {
  readonly installUrl: string;
  readonly children: string;
}): ReactNode {
  return (
    <a className="office-identity-link" href={installUrl} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}
