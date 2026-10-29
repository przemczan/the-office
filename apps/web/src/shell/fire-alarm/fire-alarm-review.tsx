import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

/**
 * Whether Now shows what the all clear would resume ("Before the all clear") rather than the alarm
 * on: the top bar's "All clear…" and Now's own open it, "Keep the alarm on" and the all clear close
 * it. It lives only in this page.
 */
export interface FireAlarmReview {
  readonly reviewing: boolean;
  open(): void;
  close(): void;
}

const FireAlarmReviewContext = createContext<FireAlarmReview | undefined>(undefined);

export function FireAlarmReviewProvider({ children }: { readonly children: ReactNode }): ReactNode {
  const [reviewing, setReviewing] = useState(false);
  const value = useMemo<FireAlarmReview>(
    () => ({ reviewing, open: () => setReviewing(true), close: () => setReviewing(false) }),
    [reviewing],
  );
  return <FireAlarmReviewContext value={value}>{children}</FireAlarmReviewContext>;
}

export function useFireAlarmReview(): FireAlarmReview {
  const review = useContext(FireAlarmReviewContext);
  if (review === undefined) throw new Error("useFireAlarmReview needs the shell's provider.");
  return review;
}
