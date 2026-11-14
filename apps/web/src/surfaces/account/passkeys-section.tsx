import { browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { useQuery } from "@tanstack/react-query";
import type { Passkey, PasskeyList } from "@the-office/contracts";
import { Alert, Badge, Button, Card, DataTable, Icon, type DataTableColumn } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { passkeyQueries } from "../../api/passkeys.ts";
import { usePageHeading } from "../../shell/page-heading.tsx";
import {
  elsewhereHref,
  elsewhereWords,
  passkeyAtWords,
  passkeysUnavailableWords,
} from "../../shell/passkey-words.ts";
import { momentWords } from "../../shell/time.ts";
import { AccountCardTitle } from "./account-card-title.tsx";
import { AddPasskeyDialog } from "./add-passkey-dialog.tsx";
import { RemovePasskeyDialog, RenamePasskeyDialog } from "./passkey-dialogs.tsx";

type OpenDialog =
  | { readonly kind: "add" }
  | { readonly kind: "rename"; readonly passkey: Passkey }
  | { readonly kind: "remove"; readonly passkey: Passkey };

/**
 * Account › Passkeys (spec §2.10): each passkey with its name, the address it works at, when it
 * was added and last used, Rename and Remove; one for the other address says where to use it, and
 * one for an address no longer The Office's says it can't sign in. Adding one asks for the current
 * password, then its name, and works only at `localhost` or the public address over HTTPS.
 */
export function PasskeysSection(): ReactNode {
  usePageHeading({ title: "Account", crumb: "Passkeys" });
  const list = useQuery(passkeyQueries.list());
  const [dialog, setDialog] = useState<OpenDialog>();
  const passkeys = list.data?.passkeys ?? [];
  return (
    <div className="account-cards">
      <Card
        padding="none"
        title={
          <AccountCardTitle icon="key-round">
            Passkeys <span className="account-count">{passkeys.length}</span>
          </AccountCardTitle>
        }
        subtitle="A passkey signs you in alone, with no password or code. Each works only at the address it was added at."
        actions={
          list.data && <AddPasskey list={list.data} onAdd={() => setDialog({ kind: "add" })} />
        }
      >
        {list.error && (
          <div className="account-banner">
            <Alert tone="danger" title="The passkeys can't be read">
              {list.error.message}
            </Alert>
          </div>
        )}
        {list.data && <AddingUnavailable list={list.data} />}
        <DataTable
          rows={passkeys}
          columns={columns({
            rename: (passkey) => setDialog({ kind: "rename", passkey }),
            remove: (passkey) => setDialog({ kind: "remove", passkey }),
          })}
          loading={list.isPending}
          empty="No passkeys yet."
        />
      </Card>
      {dialog?.kind === "add" && <AddPasskeyDialog onClose={() => setDialog(undefined)} />}
      {dialog?.kind === "rename" && (
        <RenamePasskeyDialog passkey={dialog.passkey} onClose={() => setDialog(undefined)} />
      )}
      {dialog?.kind === "remove" && (
        <RemovePasskeyDialog passkey={dialog.passkey} onClose={() => setDialog(undefined)} />
      )}
    </div>
  );
}

/** "Add a passkey", offered where adding works and the browser has passkeys. */
function AddPasskey({
  list,
  onAdd,
}: {
  readonly list: PasskeyList;
  readonly onAdd: () => void;
}): ReactNode {
  if (list.addingUnavailable !== null) return null;
  const supported = browserSupportsWebAuthn();
  return (
    <Button
      variant="primary"
      size="sm"
      iconLeft={<Icon name="plus" size={14} />}
      disabled={!supported}
      title={supported ? undefined : "This browser can't make passkeys."}
      onClick={onAdd}
    >
      Add a passkey
    </Button>
  );
}

/** Why a passkey can't be added at this address, and where it can. */
function AddingUnavailable({ list }: { readonly list: PasskeyList }): ReactNode {
  const unavailable = list.addingUnavailable;
  if (unavailable === null) return null;
  return (
    <div className="account-banner">
      <Alert tone="info" title={passkeysUnavailableWords(unavailable.reason)}>
        {unavailable.elsewhere === undefined ? (
          "Open The Office at localhost or at its public address to add one."
        ) : (
          <a href={elsewhereHref(unavailable.elsewhere, "/account/passkeys")}>
            {elsewhereWords(unavailable.elsewhere)} to add one
          </a>
        )}
      </Alert>
    </div>
  );
}

function columns(actions: {
  readonly rename: (passkey: Passkey) => void;
  readonly remove: (passkey: Passkey) => void;
}): DataTableColumn<Passkey>[] {
  return [
    {
      key: "name",
      header: "Passkey",
      wrap: true,
      render: (passkey) => (
        <span className="account-passkey">
          <span className="account-device">
            {passkey.name}
            {passkey.at === "old-address" && (
              <Badge tone="warning" size="sm">
                Old address
              </Badge>
            )}
          </span>
          <PasskeyAt passkey={passkey} />
        </span>
      ),
    },
    {
      key: "createdAt",
      header: "Added",
      muted: true,
      render: (passkey) => momentWords(passkey.createdAt),
    },
    {
      key: "lastUsedAt",
      header: "Last used",
      muted: true,
      render: (passkey) =>
        passkey.lastUsedAt === null ? "Never" : momentWords(passkey.lastUsedAt),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (passkey) => (
        <span className="account-row-actions">
          <Button
            variant="secondary"
            size="sm"
            aria-label={`Rename ${passkey.name}`}
            onClick={() => actions.rename(passkey)}
          >
            Rename
          </Button>
          <Button
            variant="secondary"
            size="sm"
            aria-label={`Remove ${passkey.name}`}
            onClick={() => actions.remove(passkey)}
          >
            Remove
          </Button>
        </span>
      ),
    },
  ];
}

/** Where the passkey works; the public address it works at is a link when it is the other one. */
function PasskeyAt({ passkey }: { readonly passkey: Passkey }): ReactNode {
  const words = passkeyAtWords(passkey);
  return (
    <span className="account-passkey-at">
      {passkey.otherAddress === undefined ? (
        words
      ) : (
        <a href={elsewhereHref(passkey.otherAddress, "/account/passkeys")}>{words}</a>
      )}
    </span>
  );
}
