import type { Locator, Page } from "@playwright/test";

/** The grouped Pipeline picker named `picker` (its label), opened, answering its list. */
export async function openPipelinePicker(scope: Locator | Page, picker: string): Promise<Locator> {
  await scope.getByRole("combobox", { name: picker, exact: true }).click();
  return scope.getByRole("listbox", { name: picker, exact: true });
}

/** Chooses the Pipeline named `pipelineName` in the grouped Pipeline picker named `picker`. */
export async function pickPipeline(
  scope: Locator | Page,
  picker: string,
  pipelineName: string,
): Promise<void> {
  const list = await openPipelinePicker(scope, picker);
  await list.getByRole("option", { name: pipelineName, exact: true }).click();
}

/** The names of the options the open list offers, in order. */
export function optionNames(list: Locator): Promise<string[]> {
  return list.locator(".grouped-select-label").allTextContents();
}
