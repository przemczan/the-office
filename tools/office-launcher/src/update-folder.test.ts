import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseRequest } from "./update-folder.ts";

describe("a request", () => {
  const release = {
    kind: "release",
    version: "1.2.0",
    from: "1.1.0",
    tarballUrl: "https://github.com/o/r/releases/download/v1.2.0/the-office-1.2.0-linux-x64.tar.gz",
    checksumUrl:
      "https://github.com/o/r/releases/download/v1.2.0/the-office-1.2.0-linux-x64.tar.gz.sha256",
  };

  test("without a kind asks for a commit", () => {
    const target = "a".repeat(40);
    assert.deepEqual(parseRequest({ target }), { kind: "commit", target });
  });

  test("of a release takes https:// URLs alone and versions without a v", () => {
    assert.deepEqual(parseRequest(release), release);
    assert.throws(
      () => parseRequest({ ...release, tarballUrl: "http://example.com/x.tar.gz" }),
      /https/,
    );
    assert.throws(() => parseRequest({ ...release, version: "v1.2.0" }), /version/);
    assert.throws(() => parseRequest({ ...release, version: "1.2.0-rc.1" }), /version/);
  });

  test("of a container names its image", () => {
    const container = {
      kind: "container",
      version: "1.2.0",
      from: "1.1.0",
      image: "ghcr.io/o/the-office",
    };
    assert.deepEqual(parseRequest(container), container);
    assert.throws(() => parseRequest({ ...container, image: "" }), /image/);
  });
});
