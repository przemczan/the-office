import { useEffect, useState } from "react";

/** The time now, renewed every `everyMs`, for figures that count up such as time in Stage. */
export function useClock(everyMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), everyMs);
    return () => window.clearInterval(timer);
  }, [everyMs]);
  return now;
}
