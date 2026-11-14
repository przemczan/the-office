import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Attachment, UserRef } from "@the-office/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { roleQueries } from "../../api/people.ts";
import { BY_ANN, BY_YOU, signIn } from "../user.fixtures.ts";
import { AttachmentViewer } from "./attachment-viewer.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

function anImage(user: UserRef): Attachment {
  return {
    kind: "image",
    id: crypto.randomUUID(),
    owner: { kind: "task", taskId: crypto.randomUUID() },
    name: "screen.png",
    addedBy: { kind: "user", user },
    addedAt: "2026-11-10T10:00:00.000Z",
    mediaType: "image/png",
    size: 64,
  } as Attachment;
}

function caption(user: UserRef): string {
  const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  queryClient.setQueryData(roleQueries.list().queryKey, []);
  signIn(queryClient);
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      <QueryClientProvider client={queryClient}>
        <AttachmentViewer
          images={[{ image: anImage(user), roundName: undefined }]}
          index={0}
          onStep={() => undefined}
          onClose={() => undefined}
        />
      </QueryClientProvider>,
    ),
  );
  return document.querySelector(".attachment-viewer-caption")?.textContent ?? "";
}

describe("AttachmentViewer", () => {
  it("names the user who added the image: You, or another user by name", () => {
    expect(caption(BY_YOU)).toContain("Added by You,");
    act(() => root?.unmount());
    document.body.replaceChildren();
    expect(caption(BY_ANN)).toContain("Added by Ann Lee,");
  });
});
