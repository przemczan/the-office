import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  OPENID_CONNECT_PROVIDER_NAME_MAX_LENGTH,
  type OpenIdConnectProvider,
} from "@the-office/contracts";
import { Alert, Badge, Button, Card, Dialog, Icon, Input } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { linkedIdentityQueries } from "../../../api/linked-identities.ts";
import {
  OPENID_CONNECT_PROVIDER,
  openIdConnectProviderQueries,
  removeOpenIdConnectProvider,
  saveOpenIdConnectProvider,
} from "../../../api/openid-connect-provider.ts";
import { useCopyText } from "../../../shell/copy-text.ts";
import { RefusalAlert } from "../../../shell/refusal-alert.tsx";
import { useToast } from "../../../shell/toasts.tsx";
import { SettingsProblem } from "../settings-card-parts.tsx";

/** An issuer URL as compared: trimmed, without a trailing slash. */
function bare(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

function sameIssuer(a: string, b: string): boolean {
  return bare(a) === bare(b);
}

/**
 * The OpenID Connect provider Continue with <name> signs in through (Zitadel, Authentik, Keycloak
 * and others): its name, issuer URL, client ID and secret, saved, changed or removed by any user.
 * The secret is write-only: once saved, the page only says so. Under it, the redirect URIs to add
 * at the provider.
 */
export function OpenIdConnectProviderCard(): ReactNode {
  const setting = useQuery(openIdConnectProviderQueries.setting());
  return (
    <Card
      title={
        <span className="settings-block-title">
          <Icon name="key" size={15} />
          OpenID Connect
        </span>
      }
      subtitle="Continue with your own identity provider (Zitadel, Authentik, Keycloak and others) signs users in through an OpenID Connect client you register there, one for every user."
    >
      <div className="signing-in-card-body">
        <SettingsProblem title="The OpenID Connect provider can't be read" error={setting.error} />
        {setting.data && (
          // Keyed by the saved provider, so the form starts again from it once saved or removed.
          <ProviderForm
            key={`${setting.data.provider?.issuer ?? ""}|${setting.data.provider?.name ?? ""}|${setting.data.provider?.clientId ?? ""}`}
            saved={setting.data.provider ?? undefined}
          />
        )}
        <RedirectUris />
      </div>
    </Card>
  );
}

function ProviderForm({ saved }: { readonly saved: OpenIdConnectProvider | undefined }): ReactNode {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const [name, setName] = useState(saved?.name ?? "");
  const [issuer, setIssuer] = useState(saved?.issuer ?? "");
  const [clientId, setClientId] = useState(saved?.clientId ?? "");
  const [clientSecret, setClientSecret] = useState("");
  const [removing, setRemoving] = useState(false);
  const saving = useMutation({
    mutationFn: () => saveOpenIdConnectProvider({ name, issuer, clientId, clientSecret }),
    onSuccess: async (provider) => {
      setClientSecret("");
      await queryClient.invalidateQueries({ queryKey: OPENID_CONNECT_PROVIDER });
      showToast(
        `The OpenID Connect provider was saved: Continue with ${provider.name} is offered.`,
      );
    },
  });
  const secretSaved = saved?.secretSet === true;
  const issuerChanged =
    saved !== undefined && issuer.trim() !== "" && !sameIssuer(issuer, saved.issuer);
  return (
    <form
      className="signing-in-form"
      aria-label="OpenID Connect provider"
      onSubmit={(event) => {
        event.preventDefault();
        saving.mutate();
      }}
    >
      {saving.error && (
        <RefusalAlert title="The OpenID Connect provider wasn't saved" error={saving.error} />
      )}
      <Input
        label="Name"
        autoComplete="off"
        placeholder="Zitadel"
        hint="Shown on the sign-in page as Continue with this name."
        maxLength={OPENID_CONNECT_PROVIDER_NAME_MAX_LENGTH}
        value={name}
        onChange={(event) => setName(event.target.value)}
        required
      />
      <Input
        label="Issuer URL"
        type="url"
        autoComplete="off"
        spellCheck={false}
        placeholder="https://auth.example.com"
        hint="The provider's address; The Office reads its discovery document from it as it saves."
        value={issuer}
        onChange={(event) => setIssuer(event.target.value)}
        required
      />
      <Input
        label="Client ID"
        autoComplete="off"
        spellCheck={false}
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
            : "Shown once at the provider when the client is created."
        }
        value={clientSecret}
        onChange={(event) => setClientSecret(event.target.value)}
        required={!secretSaved}
      />
      {issuerChanged && (
        <Alert tone="warning" title="A different issuer unlinks every linked identity">
          Saving this provider at another issuer than the saved one unlinks every identity users
          linked at the old one. They link again from Account › Linked identities.
        </Alert>
      )}
      <div className="settings-actions">
        <span className="settings-actions-state">
          {saved ? (
            <Badge tone="success" dot size="sm">
              Secret set
            </Badge>
          ) : (
            "Not set up: Continue with an OpenID Connect provider isn't offered."
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
      {removing && (
        <RemoveProviderDialog name={saved?.name ?? ""} onClose={() => setRemoving(false)} />
      )}
    </form>
  );
}

function RemoveProviderDialog({
  name,
  onClose,
}: {
  readonly name: string;
  readonly onClose: () => void;
}): ReactNode {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const removing = useMutation({
    mutationFn: removeOpenIdConnectProvider,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: OPENID_CONNECT_PROVIDER });
      showToast("The OpenID Connect provider was removed.");
      onClose();
    },
  });
  return (
    <Dialog
      size="small"
      title="Remove the OpenID Connect provider?"
      onClose={onClose}
      actions={
        <Button variant="danger" loading={removing.isPending} onClick={() => removing.mutate()}>
          Remove the provider
        </Button>
      }
    >
      <div className="dialog-stack">
        {removing.error && (
          <RefusalAlert title="The OpenID Connect provider wasn't removed" error={removing.error} />
        )}
        <p className="dialog-text">
          Continue with {name} is no longer offered. The accounts users linked stay linked, and sign
          in again once a provider is saved at the same issuer; saving one at another issuer unlinks
          them.
        </p>
      </div>
    </Dialog>
  );
}

/** The redirect URIs the provider's client must list: this page's and the public address's. */
function RedirectUris(): ReactNode {
  const urls = useQuery(linkedIdentityQueries.callbackUrls("openid-connect"));
  const listed =
    urls.data &&
    [...new Set([urls.data.thisAddress, urls.data.publicAddress])].filter((url) => url !== null);
  return (
    <section className="signing-in-part" aria-label="Redirect URIs at the provider">
      <h3 className="signing-in-subtitle">Redirect URIs</h3>
      <p className="settings-note">
        At the provider, register a web application client and add each redirect URI below. Zitadel
        accepts a plain HTTP redirect URI only while its application&apos;s Development mode is on.
        Each user then links their account from Account › Linked identities.
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
