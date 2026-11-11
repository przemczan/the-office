import { act, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { ThreadDraftsProvider, useThreadDrafts, type ThreadDrafts } from "./thread-drafts.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const TAB = "task-1/planner";
const THREAD_ID = "59834a65-2a36-4b21-bba5-8742f7ba25df";

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

function Reader({ onRead }: { readonly onRead: (drafts: ThreadDrafts) => void }): ReactNode {
  const drafts = useThreadDrafts();
  useEffect(() => {
    onRead(drafts);
  }, [drafts, onRead]);
  return null;
}

function threadDrafts(): ThreadDrafts {
  let drafts: ThreadDrafts | undefined;
  root = createRoot(document.body.appendChild(document.createElement("div")));
  act(() =>
    root?.render(
      <ThreadDraftsProvider>
        <Reader
          onRead={(read) => {
            drafts = read;
          }}
        />
      </ThreadDraftsProvider>,
    ),
  );
  if (drafts === undefined) throw new Error("The drafts weren't read.");
  return drafts;
}

describe("handing a draft over to the Thread that opened", () => {
  it("moves what was written before the Thread opened into it", () => {
    const drafts = threadDrafts();
    drafts.leave(TAB, "Signing in should bring me back.");

    drafts.handOver(TAB, THREAD_ID);

    expect(drafts.waitingIn(THREAD_ID)).toBe("Signing in should bring me back.");
    expect(drafts.waitingIn(TAB)).toBeUndefined();
  });

  it("keeps a draft already waiting in the Thread", () => {
    const drafts = threadDrafts();
    drafts.leave(THREAD_ID, "Written in the Thread.");
    drafts.leave(TAB, "Written before it opened.");

    drafts.handOver(TAB, THREAD_ID);

    expect(drafts.waitingIn(THREAD_ID)).toBe("Written in the Thread.");
  });
});
