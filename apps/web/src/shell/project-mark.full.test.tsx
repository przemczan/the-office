import type { Image, ProjectImageVersions } from "@the-office/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProjectMark } from "./project-mark.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PROJECT = { name: "Admin panel", mark: { label: "AP", colour: "teal" } } as const;
const LIGHT: Image = { id: "light-icon", mediaType: "image/png" };
const DARK: Image = { id: "dark-icon", mediaType: "image/svg+xml" };
const NONE: ProjectImageVersions = { light: null, dark: null };

function addressOf(image: Image): string {
  return `/api/projects/admin-panel/images/${image.id}/content`;
}

function rendered(icon: ProjectImageVersions, palette: "light" | "dark"): HTMLElement {
  const host = document.createElement("div");
  act(() =>
    createRoot(host).render(
      <ProjectMark project={{ ...PROJECT, id: "admin-panel", icon }} palette={palette} />,
    ),
  );
  return host;
}

function failToLoad(host: HTMLElement): void {
  act(() => {
    host.querySelector("img")?.dispatchEvent(new Event("error"));
  });
}

describe("ProjectMark", () => {
  it("draws the letters on the colour without an Icon", () => {
    const markup = renderToStaticMarkup(<ProjectMark project={{ ...PROJECT, icon: NONE }} />);

    expect(markup).toContain(">AP</span>");
    expect(markup).toContain("colour-teal");
    expect(markup).not.toContain("has-icon");
    expect(markup).not.toContain("<img");
  });

  it("draws a Project still being added, which has neither id nor Icon", () => {
    expect(renderToStaticMarkup(<ProjectMark project={PROJECT} />)).toContain(">AP</span>");
  });

  it("draws the Icon in place of the letters and the colour", () => {
    const markup = renderToStaticMarkup(
      <ProjectMark
        project={{ ...PROJECT, id: "admin-panel", icon: { light: LIGHT, dark: null } }}
      />,
    );

    expect(markup).toContain(`src="${addressOf(LIGHT)}"`);
    expect(markup).toContain("has-icon");
    expect(markup).not.toContain("AP<");
  });
});

describe("the version shown", () => {
  it.each([
    ["light", LIGHT],
    ["dark", DARK],
  ] as const)("is the %s one in the %s palette", (palette, image) => {
    const host = rendered({ light: LIGHT, dark: DARK }, palette);

    expect(host.querySelector("img")?.getAttribute("src")).toBe(addressOf(image));
  });

  it.each([
    ["light", { light: LIGHT, dark: null }, LIGHT],
    ["dark", { light: LIGHT, dark: null }, LIGHT],
    ["light", { light: null, dark: DARK }, DARK],
    ["dark", { light: null, dark: DARK }, DARK],
  ] as const)("in the %s palette is the one version held", (palette, icon, image) => {
    const host = rendered(icon, palette);

    expect(host.querySelector("img")?.getAttribute("src")).toBe(addressOf(image));
  });

  it("is the other version when the palette's own can't be loaded", () => {
    const host = rendered({ light: LIGHT, dark: DARK }, "dark");

    failToLoad(host);

    expect(host.querySelector("img")?.getAttribute("src")).toBe(addressOf(LIGHT));
  });

  it("gives way to the letters once neither version can be loaded", () => {
    const host = rendered({ light: LIGHT, dark: DARK }, "light");

    failToLoad(host);
    failToLoad(host);

    expect(host.querySelector("img")).toBeNull();
    expect(host.textContent).toBe("AP");
  });
});
