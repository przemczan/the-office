import { useQuery } from "@tanstack/react-query";
import { Icon } from "@the-office/ui";
import type { ReactNode } from "react";
import { testInstanceQueries } from "../api/test-instances.ts";

/**
 * The Test instance banner (spec screens/shell.md, "Test instance banner"): on every page of a
 * service started with `OFFICE_TEST_INSTANCE=true`, the sign-in pages and First-run setup included,
 * above the rail and the top bar, so it is never taken for the real Office. It can't be closed. It
 * reads `/api/health` once, which needs no sign-in.
 */
export function TestInstanceBanner(): ReactNode {
  const health = useQuery(testInstanceQueries.health());
  if (health.data?.testInstance !== true) return null;
  return (
    <div className="test-instance-banner" role="note" aria-label="Test instance">
      <span className="test-instance-banner-mark">
        <Icon name="flask-conical" size={13} strokeWidth={2} />
        Test instance
      </span>
      <span className="test-instance-banner-words">
        This Office runs from an Initiative&apos;s branch, to be tried. Its data is its own; it
        can&apos;t push, open a pull request, merge or start an engine session.
      </span>
      <code>OFFICE_TEST_INSTANCE</code>
    </div>
  );
}
