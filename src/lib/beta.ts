/** Inclusive last day of the public beta (local calendar date). */
export const BETA_CUTOFF_DATE = "2026-12-23";

/** Feedback form for Shelf beta testers. */
export const BETA_FEEDBACK_URL = "https://tally.so";

export type BetaStatus = {
  cutoff: string;
  expired: boolean;
  daysLeft: number;
  label: string;
};

function parseYmd(ymd: string): { y: number; m: number; d: number } {
  const [y, m, d] = ymd.split("-").map(Number);
  return { y, m, d };
}

function utcMidnight({ y, m, d }: { y: number; m: number; d: number }): number {
  return Date.UTC(y, m - 1, d);
}

function localYmd(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Beta gate for the current local calendar day. */
export function getBetaStatus(now: Date = new Date()): BetaStatus {
  const today = localYmd(now);
  const cutoff = BETA_CUTOFF_DATE;
  const daysLeft = Math.round(
    (utcMidnight(parseYmd(cutoff)) - utcMidnight(parseYmd(today))) / 86_400_000,
  );
  const expired = daysLeft < 0;
  const label = expired
    ? "Beta ended"
    : daysLeft === 0
      ? "Beta: last day"
      : `Beta: ${daysLeft} day${daysLeft === 1 ? "" : "s"} left`;
  return { cutoff, expired, daysLeft: Math.max(0, daysLeft), label };
}
