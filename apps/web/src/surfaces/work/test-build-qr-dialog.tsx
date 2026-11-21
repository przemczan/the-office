import type { TestBuildFileLink } from "@the-office/contracts";
import { Alert, Button, Dialog, Icon } from "@the-office/ui";
import type { ReactNode } from "react";
import { renderSVG } from "uqr";
import { useCopyText } from "../../shell/copy-text.ts";
import { QR_LINK_WORKS, QR_NEEDS_LAN_ADDRESS, qrTitle } from "./initiative-test-instances-words.ts";

/** A Built instance's file and the link the service gave for it, which the window shows. */
export interface ShownTestBuildLink {
  readonly fileName: string;
  readonly link: TestBuildFileLink;
}

/**
 * The QR code window (spec screens/initiative-page.md, "Test instances"): the link a phone opens
 * without sign-in, for this one file and an hour, as a QR code with the link to copy; at
 * localhost, which a phone can't reach, it says to open The Office at its LAN address instead.
 */
export function TestBuildQrDialog({
  shown,
  onClose,
}: {
  readonly shown: ShownTestBuildLink;
  readonly onClose: () => void;
}): ReactNode {
  const copyText = useCopyText();
  const { fileName, link } = shown;
  return (
    <Dialog size="small" title={qrTitle(fileName)} onClose={onClose}>
      {link.kind === "needs-lan-address" ? (
        <Alert tone="info">{QR_NEEDS_LAN_ADDRESS}</Alert>
      ) : (
        <div className="test-build-qr">
          <img
            className="test-build-qr-code"
            src={qrCodeAddressOf(link.url)}
            alt={`The QR code for ${fileName}`}
            width={200}
            height={200}
          />
          <p className="test-build-qr-words">{QR_LINK_WORKS}</p>
          <div className="test-build-qr-link">
            <code aria-label="The link">{link.url}</code>
            <Button
              size="sm"
              variant="secondary"
              iconLeft={<Icon name="copy" size={14} />}
              onClick={() =>
                copyText(link.url, {
                  copied: "Link copied.",
                  notCopied: "The link couldn't be copied. Select it and copy it instead.",
                })
              }
            >
              Copy link
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

/** The QR code as an image's address, drawn here from the link, as the authenticator's is. */
function qrCodeAddressOf(url: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(renderSVG(url, { border: 2 }))}`;
}
