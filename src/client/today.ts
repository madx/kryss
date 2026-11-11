// The local date of today as `YYYY-MM-DD`. The only place that reads the clock for due dates (PRD 5.13).
export function localToday(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
