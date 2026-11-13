import { recordPath, type RecordLink } from "@the-office/contracts";
import { useCopyText } from "./copy-text.ts";

const RECORD_WORDS: Readonly<Record<RecordLink["kind"], string>> = {
  task: "the Task",
  initiative: "the Initiative",
  decision: "the Decision",
  idea: "the Idea",
};

/**
 * Copies a record's link, to paste into any chat as a mention (spec §2.4), and says so in a toast.
 */
export function useCopyRecordLink(): (link: RecordLink) => void {
  const copyText = useCopyText();
  return (link) => {
    const url = new URL(recordPath(link), window.location.origin).href;
    copyText(url, {
      copied: `Link to ${RECORD_WORDS[link.kind]} copied. Paste it into a chat to mention it.`,
      notCopied: `The link couldn't be copied: ${url}`,
    });
  };
}
