import { Button } from "@the-office/ui";
import type { ReactNode } from "react";
import { useCopyText } from "../../shell/copy-text.ts";

const DOWNLOADED_NAME = "the-office-recovery-codes.txt";

/**
 * The recovery codes, shown this once (spec §2.10): what they are for, and the codes to copy or
 * download before the window closes.
 */
export function RecoveryCodesView({ codes }: { readonly codes: readonly string[] }): ReactNode {
  return (
    <div className="recovery-codes">
      <p className="account-words">
        Save these recovery codes somewhere safe, such as a password manager. Each signs you in once
        in place of an authenticator code, if you lose your phone. They show only now.
      </p>
      <ol className="recovery-code-list" aria-label="Recovery codes">
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ol>
    </div>
  );
}

/** Copy and Download for the recovery codes, in a window's bar. */
export function RecoveryCodesActions({ codes }: { readonly codes: readonly string[] }): ReactNode {
  const copyText = useCopyText();
  const text = `${codes.join("\n")}\n`;
  return (
    <>
      <Button
        variant="primary"
        onClick={() =>
          copyText(text, {
            copied: "Recovery codes copied.",
            notCopied: "The recovery codes couldn't be copied. Select them and copy them instead.",
          })
        }
      >
        Copy the codes
      </Button>
      <Button variant="secondary" onClick={() => download(text)}>
        Download the codes
      </Button>
    </>
  );
}

/** Saves the codes as a text file, made in the browser, so they travel nowhere else. */
function download(text: string): void {
  const address = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const link = document.createElement("a");
  link.href = address;
  link.download = DOWNLOADED_NAME;
  link.click();
  URL.revokeObjectURL(address);
}
