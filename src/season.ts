// Seasonal (Halloween) mode. Purely cosmetic and isolated from capture and
// diagnostics. Uses the user's local date only; any failure means "off".

/** Local calendar dates, inclusive. Month is 1-based. */
export const HALLOWEEN_START = { year: 2026, month: 10, day: 1 };
export const HALLOWEEN_END = { year: 2026, month: 11, day: 1 };

function dayNumber(y: number, m: number, d: number): number {
  return y * 10000 + m * 100 + d;
}

export function isHalloweenSeason(now: Date = new Date()): boolean {
  try {
    const t = now.getTime();
    if (!Number.isFinite(t)) return false;
    const today = dayNumber(now.getFullYear(), now.getMonth() + 1, now.getDate());
    return (
      today >= dayNumber(HALLOWEEN_START.year, HALLOWEEN_START.month, HALLOWEEN_START.day) &&
      today <= dayNumber(HALLOWEEN_END.year, HALLOWEEN_END.month, HALLOWEEN_END.day)
    );
  } catch {
    return false;
  }
}

/** Milliseconds until the season ends (local midnight starting Nov 2), or null if not in season. */
export function msUntilSeasonEnds(now: Date = new Date()): number | null {
  if (!isHalloweenSeason(now)) return null;
  const end = new Date(HALLOWEEN_END.year, HALLOWEEN_END.month - 1, HALLOWEEN_END.day + 1, 0, 0, 0, 0);
  return Math.max(0, end.getTime() - now.getTime());
}
