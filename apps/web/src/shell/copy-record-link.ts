import { recordPath, type RecordLink } from "@the-office/contracts";
import { useToast } from "./toasts.tsx";

const RECORD_WORDS: Readonly<Record<RecordLink["kind"], string>> = {
  task: "the Task",
  decision: "the Decision",
  idea: "the Idea",
};

/**
 * Copies a record's link, to paste into any chat as a mention (spec §2.4), and says so in a toast.
 */
export function useCopyRecordLink(): (link: RecordLink) => void {
  const showToast = useToast();
  return (link) => {
    const url = new URL(recordPath(link), window.location.origin).href;
    navigator.clipboard.writeText(url).then(
      () =>
        showToast(`Link to ${RECORD_WORDS[link.kind]} copied. Paste it into a chat to mention it.`),
      () => showToast(`The link couldn't be copied: ${url}`),
    );
  };
}
