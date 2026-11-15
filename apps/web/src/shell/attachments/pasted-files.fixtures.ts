import { act } from "react";

/** A clipboard holding `files` and, when `text` is given, that plain text too. */
export function clipboardOf(
  files: readonly File[],
  text?: string,
): Pick<DataTransfer, "types" | "files"> {
  const types = [...(text === undefined ? [] : ["text/plain"]), ...(files.length ? ["Files"] : [])];
  const fileList = Object.assign([...files], { item: (index: number) => files[index] ?? null });
  return { types, files: fileList as unknown as FileList };
}

/**
 * Pastes the clipboard into `target`, as Ctrl+V there does; true when the page kept the browser
 * from pasting it.
 */
export function paste(target: Element, files: readonly File[], text?: string): boolean {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: clipboardOf(files, text) });
  let pasted = true;
  act(() => {
    pasted = target.dispatchEvent(event);
  });
  return !pasted;
}

/** A PNG named as browsers name a pasted screenshot. */
export function screenshot(name = "image.png"): File {
  return new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], name, { type: "image/png" });
}
