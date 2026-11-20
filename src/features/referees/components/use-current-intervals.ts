"use client";

import { useEffect, useState } from "react";
import type { AvailabilityPresentation } from "../types";

// The server filters the initial agenda. Remove an interval at its exclusive
// end even when the referee leaves the agenda open across that boundary.
export function useCurrentIntervals(intervals: AvailabilityPresentation[], live = true) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!live) return;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      clearTimeout(timer);
      const time = Date.now();
      setNow(time);
      const next = intervals.reduce((nearest, interval) => {
        const end = Date.parse(interval.endsAt);
        return end > time ? Math.min(nearest, end) : nearest;
      }, Infinity);
      if (Number.isFinite(next)) timer = setTimeout(refresh, Math.min(next - time, 2_147_483_647));
    };
    refresh();
    document.addEventListener("visibilitychange", refresh);
    return () => { clearTimeout(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [intervals, live]);
  return live ? intervals.filter(interval => Date.parse(interval.endsAt) > now) : intervals;
}
