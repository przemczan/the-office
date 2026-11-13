import { useToast } from "./toasts.tsx";

/** What the toast says once the text is copied, or when it couldn't be. */
export interface CopyWords {
  readonly copied: string;
  readonly notCopied: string;
  /** Called when the text couldn't be copied, so the place can show it to copy by hand. */
  readonly onNotCopied?: () => void;
}

const TEXT_WORDS: CopyWords = {
  copied: "Copied.",
  notCopied: "The text couldn't be copied. Select it and copy it instead.",
};

/** Copies text to the clipboard and says so in a toast, or says it couldn't be copied. */
export function useCopyText(): (text: string, words?: CopyWords) => void {
  const showToast = useToast();
  return (text, { copied, notCopied, onNotCopied } = TEXT_WORDS) => {
    const settle = (wasCopied: boolean): void => {
      if (wasCopied) {
        showToast(copied);
        return;
      }
      onNotCopied?.();
      showToast(notCopied);
    };
    // The browser offers no Clipboard API to a page served over plain http, such as on another
    // computer, and may refuse it elsewhere; the older copy command still works in both cases.
    if (!("clipboard" in navigator)) {
      settle(copiedByCommand(text));
      return;
    }
    navigator.clipboard.writeText(text).then(
      () => settle(true),
      () => settle(copiedByCommand(text)),
    );
  };
}

/** Copies text by selecting it in a hidden text area and running the browser's copy command. */
function copiedByCommand(text: string): boolean {
  if (typeof document.execCommand !== "function") return false;
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  // Placed beside the focused element so a dialog's focus trap doesn't pull focus back out of it.
  const container = focused?.parentElement ?? document.body;
  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.readOnly = true;
  textArea.setAttribute("aria-hidden", "true");
  textArea.style.position = "fixed";
  textArea.style.top = "0";
  textArea.style.left = "0";
  textArea.style.opacity = "0";
  textArea.style.pointerEvents = "none";
  container.append(textArea);
  textArea.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textArea.remove();
    focused?.focus({ preventScroll: true });
  }
}
