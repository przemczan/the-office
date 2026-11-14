import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { GoogleClient } from "@the-office/contracts";
import { Badge, Button, Card, Dialog, Icon, Input } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import {
  GOOGLE_CLIENT,
  googleClientQueries,
  removeGoogleClient,
  saveGoogleClient,
} from "../../../api/google-client.ts";
import { linkedIdentityQueries } from "../../../api/linked-identities.ts";
import { useCopyText } from "../../../shell/copy-text.ts";
import { GoogleMark } from "../../../shell/google-mark.tsx";
import { RefusalAlert } from "../../../shell/refusal-alert.tsx";
import { useToast } from "../../../shell/toasts.tsx";
import { SettingsProblem } from "../settings-card-parts.tsx";

/**
 * The Google OAuth client Continue with Google signs in through: its client ID and secret, saved,
 * changed or removed by any user. The secret is write-only: once saved, the page only says so.
 * Under it, the redirect URIs to register and the steps in Google Cloud Console.
 */
export function GoogleClientCard(): ReactNode {
  const setting = useQuery(googleClientQueries.setting());
  return (
    <Card
      title={
        <span className="settings-block-title">
          <GoogleMark size={15} />
          Google
        </span>
      }
      subtitle="Continue with Google signs users in through a Google OAuth client you register, one for every user."
    >
      <div className="signing-in-card-body">
        <SettingsProblem title="The Google OAuth client can't be read" error={setting.error} />
        {setting.data && (
          // Keyed by the saved client, so the form starts again from it once saved or removed.
          <ClientForm
            key={setting.data.client?.clientId ?? ""}
            saved={setting.data.client ?? undefined}
          />
        )}
        <RedirectUris />
        <SetupSteps />
      </div>
    </Card>
  );
}

function ClientForm({ saved }: { readonly saved: GoogleClient | undefined }): ReactNode {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const [clientId, setClientId] = useState(saved?.clientId ?? "");
  const [clientSecret, setClientSecret] = useState("");
  const [removing, setRemoving] = useState(false);
  const saving = useMutation({
    mutationFn: () => saveGoogleClient({ clientId, clientSecret }),
    onSuccess: async () => {
      setClientSecret("");
      await queryClient.invalidateQueries({ queryKey: GOOGLE_CLIENT });
      showToast(
        "The Google OAuth client was saved: Continue with Google is offered at localhost and the public address.",
      );
    },
  });
  const secretSaved = saved?.secretSet === true;
  return (
    <form
      className="signing-in-form"
      aria-label="Google OAuth client"
      onSubmit={(event) => {
        event.preventDefault();
        saving.mutate();
      }}
    >
      {saving.error && (
        <RefusalAlert title="The Google OAuth client wasn't saved" error={saving.error} />
      )}
      <Input
        label="Client ID"
        autoComplete="off"
        spellCheck={false}
        placeholder="1234-abc.apps.googleusercontent.com"
        value={clientId}
        onChange={(event) => setClientId(event.target.value)}
        required
      />
      <Input
        label="Client secret"
        type="password"
        autoComplete="off"
        placeholder={secretSaved ? "Saved" : undefined}
        hint={
          secretSaved
            ? "Saved, and never shown again. Leave it empty to keep it, or enter a new one."
            : "Shown once in Google Cloud Console when the client is created."
        }
        value={clientSecret}
        onChange={(event) => setClientSecret(event.target.value)}
        required={!secretSaved}
      />
      <div className="settings-actions">
        <span className="settings-actions-state">
          {saved ? (
            <Badge tone="success" dot size="sm">
              Secret set
            </Badge>
          ) : (
            "Not set up: Continue with Google isn't offered."
          )}
        </span>
        {saved && (
          <Button variant="secondary" size="sm" onClick={() => setRemoving(true)}>
            Remove
          </Button>
        )}
        <Button variant="primary" size="sm" type="submit" loading={saving.isPending}>
          Save
        </Button>
      </div>
      {removing && <RemoveClientDialog onClose={() => setRemoving(false)} />}
    </form>
  );
}

function RemoveClientDialog({ onClose }: { readonly onClose: () => void }): ReactNode {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const removing = useMutation({
    mutationFn: removeGoogleClient,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: GOOGLE_CLIENT });
      showToast("The Google OAuth client was removed.");
      onClose();
    },
  });
  return (
    <Dialog
      size="small"
      title="Remove the Google OAuth client?"
      onClose={onClose}
      actions={
        <Button variant="danger" loading={removing.isPending} onClick={() => removing.mutate()}>
          Remove the client
        </Button>
      }
    >
      <div className="dialog-stack">
        {removing.error && (
          <RefusalAlert title="The Google OAuth client wasn't removed" error={removing.error} />
        )}
        <p className="dialog-text">
          Continue with Google is no longer offered. The Google accounts users linked stay linked,
          and sign in again once a client is saved.
        </p>
      </div>
    </Dialog>
  );
}

/**
 * The redirect URIs the client must list: this page's, at localhost, and the public address's.
 */
function RedirectUris(): ReactNode {
  const urls = useQuery(linkedIdentityQueries.callbackUrls("google"));
  const listed =
    urls.data &&
    [...new Set([urls.data.thisAddress, urls.data.publicAddress])].filter((url) => url !== null);
  return (
    <section className="signing-in-part" aria-label="Redirect URIs">
      <h3 className="signing-in-subtitle">Redirect URIs</h3>
      <p className="settings-note">
        Google sends users back only to a redirect URI the client lists, and never to an IP address:
        list The Office at localhost and at its public address over HTTPS.
        {urls.data?.thisAddress === null &&
          " This page is open at an IP address: open The Office at localhost to see its URI."}
      </p>
      {listed && listed.length > 0 && (
        <ul className="signing-in-uris">
          {listed.map((url) => (
            <RedirectUri key={url} url={url} />
          ))}
        </ul>
      )}
      <SettingsProblem title="The redirect URIs can't be read" error={urls.error} />
    </section>
  );
}

function RedirectUri({ url }: { readonly url: string }): ReactNode {
  const copyText = useCopyText();
  return (
    <li className="signing-in-uri">
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

function SetupSteps(): ReactNode {
  return (
    <section className="signing-in-part" aria-label="Setting up the client">
      <h3 className="signing-in-subtitle">Setting up the client in Google Cloud Console</h3>
      <ol className="signing-in-steps">
        <li>
          In{" "}
          <a
            href="https://console.cloud.google.com/apis/credentials"
            target="_blank"
            rel="noreferrer"
          >
            Google Cloud Console › APIs &amp; Services › Credentials
          </a>
          , choose Create credentials › OAuth client ID, with the application type Web application.
        </li>
        <li>Under Authorized redirect URIs, add each URI above, then create the client.</li>
        <li>Copy its client ID and client secret here, and save.</li>
        <li>
          On the OAuth consent screen, choose External, and the scopes openid and email. While it is
          in Testing, add each user&apos;s Google account as a test user; or publish it, which needs
          no verification for these scopes.
        </li>
        <li>Each user then links their Google account from Account › Linked identities.</li>
      </ol>
    </section>
  );
}
