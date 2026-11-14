import type { AnyRouter } from "@tanstack/react-router";
import { act } from "react";
import { openPage } from "../../shell/page.fixtures.tsx";
import { SignInPage } from "./sign-in-page.tsx";

export {
  closePage as closeSignInPage,
  stubService,
  typed,
  until,
} from "../../shell/page.fixtures.tsx";

/** The sign-in page at `path`, with a page to return to, `/work`, and home. */
export function openSignInPage(
  path: string,
): Promise<{ readonly page: HTMLElement; readonly router: AnyRouter }> {
  return openPage(path, {
    "sign-in": SignInPage,
    work: () => <p>The Work page</p>,
    "/": () => <p>Home</p>,
  });
}

/** The form by its name, as a screen reader names it. */
export function formNamed(page: HTMLElement, name: string): HTMLFormElement | null {
  return page.querySelector<HTMLFormElement>(`form[aria-label="${name}"]`);
}

/** Presses the form's submit button. */
export function submitted(form: HTMLFormElement | null): void {
  const button = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (!button) throw new Error("There is no form to submit.");
  act(() => button.click());
}
