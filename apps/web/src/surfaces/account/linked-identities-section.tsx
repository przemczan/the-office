import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import {
  LINK_FAILED_PARAMETER,
  LINKED_IDENTITIES_PATH,
  type IdentityProvider,
  type LinkedIdentityList,
  type WayUnavailable,
} from "@the-office/contracts";
import { Alert, Badge, Button, Card, Dialog, Icon } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import {
  LINKED_IDENTITIES,
  linkedIdentityQueries,
  startLinking,
  unlinkIdentity,
} from "../../api/linked-identities.ts";
import { GoogleMark } from "../../shell/google-mark.tsx";
import { googleUnavailableWords } from "../../shell/google-words.ts";
import { usePageHeading } from "../../shell/page-heading.tsx";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import { momentWords } from "../../shell/time.ts";
import { useToast } from "../../shell/toasts.tsx";
import { AccountCardTitle } from "./account-card-title.tsx";

type ProviderLink = LinkedIdentityList[number];

/**
 * Each provider as the page names it, why linking it isn't possible before it is set up, and why
 * not at this address.
 */
const PROVIDERS: Readonly<
  Record<
    IdentityProvider,
    {
      readonly name: string;
      readonly icon: ReactNode;
      readonly notSetUp: string;
      readonly notHere: (why: WayUnavailable) => string;
    }
  >
> = {
  github: {
    name: "GitHub",
    icon: <Icon name="github" size={18} />,
    notSetUp: "Register the GitHub App in Settings › Office identity first.",
    // GitHub sends the browser back to any callback URL the App lists, so it works at every address.
    notHere: () => "Linking GitHub doesn't work at this address.",
  },
  google: {
    name: "Google",
    icon: <GoogleMark size={18} />,
    notSetUp: "Save a Google OAuth client in Settings › Signing in first.",
    notHere: ({ reason, elsewhere }) =>
      `${googleUnavailableWords(reason)} Open The Office at ${
        elsewhere === undefined ? "localhost or its public address" : new URL(elsewhere).host
      } to link it.`,
  },
};

/**
 * Account › Linked identities (spec §2.10): each provider with the identity linked there, when it
 * was linked and last signed in with, and Unlink; or Link, which goes to the provider and back.
 * Continue with the provider signs in only an identity linked here.
 */
export function LinkedIdentitiesSection(): ReactNode {
  usePageHeading({ title: "Account", crumb: "Linked identities" });
  const list = useQuery(linkedIdentityQueries.list());
  const [unlinking, setUnlinking] = useState<ProviderLink>();
  return (
    <div className="account-cards">
      <Card
        padding="none"
        title={<AccountCardTitle icon="link">Linked identities</AccountCardTitle>}
        subtitle="Continue with GitHub or Google on the sign-in page signs you in with the account linked here, never by your email."
      >
        <LinkFailure />
        {list.error && (
          <div className="account-banner">
            <Alert tone="danger" title="The linked identities can't be read">
              {list.error.message}
            </Alert>
          </div>
        )}
        <ul className="account-identities">
          {list.data?.map((link) => (
            <ProviderRow key={link.provider} link={link} onUnlink={() => setUnlinking(link)} />
          ))}
        </ul>
      </Card>
      {unlinking && <UnlinkDialog link={unlinking} onClose={() => setUnlinking(undefined)} />}
    </div>
  );
}

/** Why linking didn't work, as the provider's trip back said; dismissed by the user. */
function LinkFailure(): ReactNode {
  const search = useSearch({ from: LINKED_IDENTITIES_PATH });
  const navigate = useNavigate({ from: LINKED_IDENTITIES_PATH });
  const reason = search[LINK_FAILED_PARAMETER];
  if (reason === undefined) return null;
  return (
    <div className="account-banner">
      <Alert
        tone="danger"
        title="The identity wasn't linked"
        onClose={() => void navigate({ search: {}, replace: true })}
      >
        {reason}
      </Alert>
    </div>
  );
}

function ProviderRow({
  link,
  onUnlink,
}: {
  readonly link: ProviderLink;
  readonly onUnlink: () => void;
}): ReactNode {
  const provider = PROVIDERS[link.provider];
  const { linked } = link;
  return (
    <li className="account-identity">
      {provider.icon}
      <span className="account-identity-main">
        <span className="account-device">
          {provider.name}
          {linked && (
            <Badge tone="success" dot size="sm">
              {linked.name}
            </Badge>
          )}
        </span>
        <span className="account-identity-when">
          {linked
            ? `Linked ${momentWords(linked.linkedAt)} · ${
                linked.lastSignedInAt === null
                  ? "never signed in with"
                  : `last signed in ${momentWords(linked.lastSignedInAt)}`
              }`
            : (whyNotLinkable(link) ?? "Not linked.")}
        </span>
      </span>
      <span className="account-row-actions">
        {linked ? (
          <Button
            variant="secondary"
            size="sm"
            aria-label={`Unlink ${provider.name}`}
            onClick={onUnlink}
          >
            Unlink
          </Button>
        ) : (
          <LinkButton provider={link.provider} notLinkable={whyNotLinkable(link)} />
        )}
      </span>
    </li>
  );
}

/** Why Link can't start: the provider isn't set up, or doesn't work at this address. */
function whyNotLinkable({
  provider,
  available,
  unavailableHere,
}: ProviderLink): string | undefined {
  if (!available) return PROVIDERS[provider].notSetUp;
  if (unavailableHere !== null) return PROVIDERS[provider].notHere(unavailableHere);
  return undefined;
}

/** Goes to the provider, which sends the browser back to the account linked or with why not. */
function LinkButton({
  provider,
  notLinkable,
}: {
  readonly provider: IdentityProvider;
  readonly notLinkable: string | undefined;
}): ReactNode {
  const linking = useMutation({
    mutationFn: () => startLinking(provider),
    onSuccess: ({ authorizeUrl }) => window.location.assign(authorizeUrl),
  });
  const { name } = PROVIDERS[provider];
  return (
    <>
      {linking.error && <RefusalAlert title="Linking can't start" error={linking.error} />}
      <Button
        variant="primary"
        size="sm"
        aria-label={`Link ${name}`}
        disabled={notLinkable !== undefined}
        title={notLinkable}
        // Still going once answered, until the browser leaves for the provider.
        loading={linking.isPending || linking.isSuccess}
        onClick={() => linking.mutate()}
      >
        Link
      </Button>
    </>
  );
}

function UnlinkDialog({
  link,
  onClose,
}: {
  readonly link: ProviderLink;
  readonly onClose: () => void;
}): ReactNode {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const { name } = PROVIDERS[link.provider];
  const unlinking = useMutation({
    mutationFn: () => unlinkIdentity(link.provider),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: LINKED_IDENTITIES });
      showToast(`Your ${name} account was unlinked.`);
      onClose();
    },
  });
  return (
    <Dialog
      size="small"
      title={`Unlink ${name}?`}
      onClose={onClose}
      actions={
        <Button variant="danger" loading={unlinking.isPending} onClick={() => unlinking.mutate()}>
          Unlink the account
        </Button>
      }
    >
      <div className="dialog-stack">
        {unlinking.error && (
          <RefusalAlert title={`${name} can't be unlinked`} error={unlinking.error} />
        )}
        <p className="dialog-text">
          Continue with {name} no longer signs you in as {link.linked?.name}. You can link it again
          from here.
        </p>
      </div>
    </Dialog>
  );
}
