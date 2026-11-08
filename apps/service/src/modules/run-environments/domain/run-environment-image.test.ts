import { describe, expect, it } from "vitest";
import {
  imageKeyOf,
  imageNameOf,
  installDockerfile,
  type ImageInputs,
} from "./run-environment-image.js";

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

const INPUTS: ImageInputs = {
  definitionFiles: [
    { path: ".devcontainer/devcontainer.json", content: bytes("{}") },
    { path: ".devcontainer/compose.yaml", content: bytes("services: {}") },
  ],
  installCommand: "npm ci",
  installInputs: [{ path: "package-lock.json", content: bytes('{"lockfileVersion":3}') }],
};

describe("imageKeyOf", () => {
  it("gives the same key for the same inputs, whatever their order", () => {
    const reordered = { ...INPUTS, definitionFiles: INPUTS.definitionFiles.toReversed() };

    expect(imageKeyOf(reordered)).toBe(imageKeyOf(INPUTS));
  });

  it("changes with an Install input's contents", () => {
    const changed = {
      ...INPUTS,
      installInputs: [{ path: "package-lock.json", content: bytes('{"lockfileVersion":4}') }],
    };

    expect(imageKeyOf(changed)).not.toBe(imageKeyOf(INPUTS));
  });

  it("changes with an Install input appearing", () => {
    const absent = {
      ...INPUTS,
      installInputs: [{ path: "package-lock.json", content: undefined }],
    };

    expect(imageKeyOf(absent)).not.toBe(imageKeyOf(INPUTS));
  });

  it("changes with a definition file and with the install command", () => {
    const definitionChanged = {
      ...INPUTS,
      definitionFiles: [{ path: ".devcontainer/devcontainer.json", content: bytes("{ }") }],
    };

    expect(imageKeyOf(definitionChanged)).not.toBe(imageKeyOf(INPUTS));
    expect(imageKeyOf({ ...INPUTS, installCommand: "npm install" })).not.toBe(imageKeyOf(INPUTS));
  });

  it("tells a file's contents from its path", () => {
    const one = { ...INPUTS, installInputs: [{ path: "ab", content: bytes("c") }] };
    const other = { ...INPUTS, installInputs: [{ path: "a", content: bytes("bc") }] };

    expect(imageKeyOf(one)).not.toBe(imageKeyOf(other));
  });
});

describe("imageNameOf and installDockerfile", () => {
  it("tag the image by Project and key", () => {
    expect(imageNameOf("the-office", "abc123")).toBe("the-office/the-office:abc123");
  });

  it("run the install command over the definition's image, exactly as kept", () => {
    expect(installDockerfile("node:22", "npm ci && echo 'done'")).toBe(
      [
        "FROM node:22",
        "COPY install-inputs/ /office-install/",
        "WORKDIR /office-install",
        `RUN ["/bin/sh","-c","npm ci && echo 'done'"]`,
        "",
      ].join("\n"),
    );
    expect(installDockerfile("node:22", undefined)).not.toContain("RUN");
  });
});
