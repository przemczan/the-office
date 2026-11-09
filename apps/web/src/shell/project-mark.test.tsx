import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProjectMark } from "./project-mark.tsx";

const PROJECT = { name: "Admin panel", mark: { label: "AP", colour: "teal" } } as const;
const ICON = { id: "an-image", mediaType: "image/png" } as const;

describe("ProjectMark", () => {
  it("draws the letters on the colour without an Icon", () => {
    const markup = renderToStaticMarkup(<ProjectMark project={{ ...PROJECT, icon: null }} />);

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
      <ProjectMark project={{ ...PROJECT, id: "admin-panel", icon: ICON }} />,
    );

    expect(markup).toContain('src="/api/projects/admin-panel/images/an-image/content"');
    expect(markup).toContain("has-icon");
    expect(markup).not.toContain("AP<");
  });
});
