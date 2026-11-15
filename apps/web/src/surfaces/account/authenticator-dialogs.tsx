import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { AuthenticatorSetup } from "@the-office/contracts";
import { Button, Dialog } from "@the-office/ui";
import { useId, useState, type ReactNode } from "react";
import { renderSVG } from "uqr";
import {
  ACCOUNT,
  confirmAuthenticator,
  makeNewRecoveryCodes,
  turnOffAuthenticator,
} from "../../api/users.ts";
import {
  CodeAnswerField,
  CodeRefusalAlert,
  NO_CODE_ANSWER,
  codeAnswerOf,
  useCodeRefusal,
  type CodeAnswerDraft,
} from "../../shell/code-answer-field.tsx";
import { RecoveryCodesActions, RecoveryCodesView } from "./recovery-codes-view.tsx";

/**
 * Setting up the authenticator: the QR code to scan, or the key to type in by hand, and the first
 * code that turns it on; then the recovery codes, shown this once.
 */
export function SetUpAuthenticatorDialog({
  setup,
  onClose,
}: {
  readonly setup: AuthenticatorSetup;
  readonly onClose: () => void;
}): ReactNode {
  const formId = useId();
  const [draft, setDraft] = useState<CodeAnswerDraft>(NO_CODE_ANSWER);
  const queryClient = useQueryClient();
  const confirming = useMutation({
    mutationFn: () => confirmAuthenticator(draft.value.trim()),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ACCOUNT }),
  });
  const refusal = useCodeRefusal(confirming.error);
  const codes = confirming.data?.recoveryCodes;
  return (
    <Dialog
      size="medium"
      title={codes ? "Save your recovery codes" : "Set up the authenticator"}
      unsavedChanges={codes ? false : undefined}
      onClose={onClose}
      actions={
        codes ? (
          <RecoveryCodesActions codes={codes} />
        ) : (
          <Button variant="primary" type="submit" form={formId} loading={confirming.isPending}>
            Turn on the authenticator
          </Button>
        )
      }
    >
      {codes ? (
        <RecoveryCodesView codes={codes} />
      ) : (
        <form
          id={formId}
          className="authenticator-setup"
          aria-label="Set up the authenticator"
          onSubmit={(event) => {
            event.preventDefault();
            confirming.mutate();
          }}
        >
          <p className="account-words">
            Scan the QR code with an authenticator app on your phone, such as 1Password, Google
            Authenticator or Microsoft Authenticator, then type the code it shows.
          </p>
          <div className="authenticator-key">
            <img
              className="authenticator-qr"
              src={qrCodeAddressOf(setup.keyUri)}
              alt="The QR code for your authenticator app"
              width={180}
              height={180}
            />
            <div className="authenticator-typed-key">
              <span className="account-words">Can't scan it? Type this key into the app:</span>
              <code aria-label="The key">{groupedKey(setup.secret)}</code>
            </div>
          </div>
          {refusal && <CodeRefusalAlert refusal={refusal} />}
          <CodeAnswerField draft={draft} onChange={setDraft} recoveryCodeTaken={false} autoFocus />
        </form>
      )}
    </Dialog>
  );
}

/** Turning the authenticator off, with its code or a recovery code. */
export function TurnOffAuthenticatorDialog({
  onClose,
}: {
  readonly onClose: () => void;
}): ReactNode {
  const formId = useId();
  const [draft, setDraft] = useState<CodeAnswerDraft>(NO_CODE_ANSWER);
  const queryClient = useQueryClient();
  const turningOff = useMutation({
    mutationFn: () => turnOffAuthenticator(codeAnswerOf(draft)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ACCOUNT });
      onClose();
    },
  });
  const refusal = useCodeRefusal(turningOff.error);
  return (
    <Dialog
      size="small"
      title="Turn off the authenticator"
      onClose={onClose}
      actions={
        <Button
          variant="danger"
          type="submit"
          form={formId}
          loading={turningOff.isPending}
          disabled={refusal?.waitWords !== undefined}
          title={refusal?.waitWords}
        >
          Turn off
        </Button>
      }
    >
      <form
        id={formId}
        className="authenticator-setup"
        aria-label="Turn off the authenticator"
        onSubmit={(event) => {
          event.preventDefault();
          turningOff.mutate();
        }}
      >
        <p className="account-words">
          Signing in then asks for no code, and your recovery codes stop working.
        </p>
        {refusal && <CodeRefusalAlert refusal={refusal} />}
        <CodeAnswerField draft={draft} onChange={setDraft} autoFocus />
      </form>
    </Dialog>
  );
}

/** Making new recovery codes with the authenticator's code; the old ones stop working. */
export function NewRecoveryCodesDialog({ onClose }: { readonly onClose: () => void }): ReactNode {
  const formId = useId();
  const [draft, setDraft] = useState<CodeAnswerDraft>(NO_CODE_ANSWER);
  const queryClient = useQueryClient();
  const making = useMutation({
    mutationFn: () => makeNewRecoveryCodes(draft.value.trim()),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ACCOUNT }),
  });
  const refusal = useCodeRefusal(making.error);
  const codes = making.data?.recoveryCodes;
  return (
    <Dialog
      size="medium"
      title={codes ? "Save your new recovery codes" : "Make new recovery codes"}
      unsavedChanges={codes ? false : undefined}
      onClose={onClose}
      actions={
        codes ? (
          <RecoveryCodesActions codes={codes} />
        ) : (
          <Button
            variant="primary"
            type="submit"
            form={formId}
            loading={making.isPending}
            disabled={refusal?.waitWords !== undefined}
            title={refusal?.waitWords}
          >
            Make new recovery codes
          </Button>
        )
      }
    >
      {codes ? (
        <RecoveryCodesView codes={codes} />
      ) : (
        <form
          id={formId}
          className="authenticator-setup"
          aria-label="Make new recovery codes"
          onSubmit={(event) => {
            event.preventDefault();
            making.mutate();
          }}
        >
          <p className="account-words">
            New recovery codes replace all your old ones, used or not, which then stop working.
          </p>
          {refusal && <CodeRefusalAlert refusal={refusal} />}
          <CodeAnswerField draft={draft} onChange={setDraft} recoveryCodeTaken={false} autoFocus />
        </form>
      )}
    </Dialog>
  );
}

/**
 * The QR code as an image's address, drawn here from the key's `otpauth://` address, so it
 * reaches no other site. Dark on light, as scanners need it in every palette.
 */
function qrCodeAddressOf(keyUri: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(renderSVG(keyUri, { border: 2 }))}`;
}

/** The key in groups of 4, easier to type. */
function groupedKey(secret: string): string {
  return secret.match(/.{1,4}/g)?.join(" ") ?? secret;
}
