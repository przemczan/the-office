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
import { linkedIdentityQueries } from "../../../api/linked-identities.ts";
import { useCopyText } from "../../../shell/copy-text.ts";
import { GitHubPermissionsPrompt } from "../../../shell/github-permissions-prompt.tsx";
import { RefusalAlert } from "../../../shell/refusal-alert.tsx";
import { SettingsCardTitle, SettingsProblem } from "../settings-card-parts.tsx";

type ReturnFailureParameter =
  typeof GITHUB_APP_REGISTRATION_FAILED_PARAMETER | typeof GITHUB_SIGN_IN_FAILED_PARAMETER;

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

/**
 * Why registering or signing in failed, as GitHub's return to The Office said; dismissed by the
 * user. Read loosely, as Settings › Office identity and First-run setup's GitHub step both carry
 * the parameters.
 */
function ReturnFailures(): ReactNode {
  const search = useSearch({ strict: false });
  const navigate = useNavigate();
  const dismiss = (parameter: ReturnFailureParameter) => (): void => {
    void navigate({
      to: ".",
      search: (shown: Record<string, unknown>) => {
        const { [parameter]: _dismissed, ...rest } = shown;
        return rest;
      },
      replace: true,
    });
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
          <ContinueWithGitHubSetup app={state.app} />
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
          <GitHubPermissionsPrompt />
          <p className="settings-note">
            Through the GitHub App {state.app.slug}, registered on {state.app.owner}. The Office
            reaches only the repositories it is installed on.
          </p>
          <InstallLink installUrl={state.app.installUrl}>
            Install the App on more repositories
          </InstallLink>
          <ContinueWithGitHubSetup app={state.app} />
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
        <li>Contents, Pull requests, Workflows and Actions: read and write</li>
        <li>Checks and Commit statuses: read</li>
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

type RegisteredApp = Extract<GitHubState, { readonly app: unknown }>["app"];

/**
 * What users' Continue with GitHub needs of the App: GitHub sends the browser back only to a
 * callback URL the App lists, so the URLs to add for this address and the public address; the App
 * is private, so only its owner can sign in with it until it is made public; and the git
 * identity's account must keep its authorization of the App.
 */
function ContinueWithGitHubSetup({ app }: { readonly app: RegisteredApp }): ReactNode {
  const urls = useQuery(linkedIdentityQueries.callbackUrls("github"));
  const callbackUrls = urls.data && [
    ...new Set([urls.data.thisAddress, urls.data.publicAddress].filter((url) => url !== null)),
  ];
  return (
    <section className="office-identity-continue" aria-label="Continue with GitHub">
      <h3 className="office-identity-subtitle">Continue with GitHub</h3>
      <p className="settings-note">
        Users sign in to The Office with their linked GitHub account through this App. GitHub sends
        them back only to a callback URL the App lists: in the App&apos;s settings on GitHub, under
        General › Identifying and authorizing users, add each of these with Add Callback URL. An App
        lists at most 10.
      </p>
      {callbackUrls && (
        <ul className="office-identity-callbacks">
          {callbackUrls.map((url) => (
            <CallbackUrl key={url} url={url} />
          ))}
        </ul>
      )}
      <SettingsProblem title="The callback URLs can't be read" error={urls.error} />
      <Alert tone="info" title="Only the App's owner can continue with GitHub until it is public">
        The App is private, so GitHub lets only {app.owner} (or the members of that organization)
        authorize it. For others to continue with GitHub, make it public in the App&apos;s settings
        on GitHub, under Advanced › Make public. The Office kept none of the App&apos;s private key,
        and signs in only GitHub accounts linked to its users.
      </Alert>
      <Alert tone="warning" title="Keep the App authorized on the git identity's account">
        Don&apos;t revoke the App&apos;s authorization on GitHub from the account Sign in with
        GitHub uses (Settings › Applications › Authorized GitHub Apps): that ends its token, and The
        Office&apos;s git signs out.
      </Alert>
    </section>
  );
}

function CallbackUrl({ url }: { readonly url: string }): ReactNode {
  const copyText = useCopyText();
  return (
    <li className="office-identity-callback">
      <code>{url}</code>
      <Button
        variant="secondary"
        size="sm"
        iconLeft={<Icon name="copy" size={14} />}
        aria-label={`Copy ${url}`}
        onClick={() => copyText(url)}
      >
        Copy
      </Button>
    </li>
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
