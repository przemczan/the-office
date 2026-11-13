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
    const failed = (): void => {
      onNotCopied?.();
      showToast(notCopied);
    };
    // The browser offers no clipboard to a page served over plain http, such as on another computer.
    if (!("clipboard" in navigator)) {
      failed();
      return;
    }
    navigator.clipboard.writeText(text).then(() => showToast(copied), failed);
  };
}
