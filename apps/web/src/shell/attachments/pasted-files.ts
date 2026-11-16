import { useEffect, useEffectEvent } from "react";

/** The name a browser gives an image pasted without one of its own, such as a screenshot. */
const GENERIC_IMAGE_NAME = /^image\.(\w+)$/i;

/**
 * The files a paste carries, each image without a real name named for `now`. None when it also
 * carries plain text: copying cells or a web page can bring a picture along, and the paste is then
 * the text.
 */
export function pastedFiles(
  clipboard: Pick<DataTransfer, "types" | "files"> | null,
  now = new Date(),
): readonly File[] {
  if (!clipboard || clipboard.types.includes("text/plain")) return [];
  const files = [...clipboard.files];
  let unnamed = 0;
  return files.map((file) => {
    const extension = unnamedImageExtension(file);
    if (extension === undefined) return file;
    unnamed += 1;
    return new File([file], pastedImageName(now, extension, unnamed), {
      type: file.type,
      lastModified: file.lastModified,
    });
  });
}

/**
 * "Pasted image 2026-11-15 14.05.09.png", `-2`, `-3`… after the time for later images of the same
 * paste. Dots stand between the hours, minutes and seconds, as Windows forbids colons in file names.
 */
export function pastedImageName(now: Date, extension: string, ordinal = 1): string {
  const date = [now.getFullYear(), twoDigits(now.getMonth() + 1), twoDigits(now.getDate())];
  const time = [now.getHours(), now.getMinutes(), now.getSeconds()].map(twoDigits);
  const suffix = ordinal > 1 ? `-${ordinal}` : "";
  return `Pasted image ${date.join("-")} ${time.join(".")}${suffix}.${extension}`;
}

/**
 * While the component is shown, hands over the files of every paste in the page, wherever the
 * focus is, and keeps the browser from pasting them; a paste of text is left to the browser.
 */
export function usePastedFiles(onFiles: (files: readonly File[]) => void): void {
  const handOver = useEffectEvent(onFiles);
  useEffect(() => {
    const onPaste = (event: ClipboardEvent): void => {
      // A message box took the paste for its own message (`Composer`).
      if (event.defaultPrevented) return;
      const files = pastedFiles(event.clipboardData);
      if (files.length === 0) return;
      event.preventDefault();
      handOver(files);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, []);
}

function unnamedImageExtension(file: File): string | undefined {
  if (!file.type.startsWith("image/")) return undefined;
  if (file.name === "") return file.type.slice("image/".length).split("+")[0];
  return GENERIC_IMAGE_NAME.exec(file.name)?.[1];
}

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}
