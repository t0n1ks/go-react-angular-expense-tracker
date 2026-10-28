// The user's LOCAL calendar date as YYYY-MM-DD. Never use
// toISOString().slice(0, 10) for "today": that is the UTC date, which is still
// yesterday (or already tomorrow) for part of the day in most timezones.
export function toLocalDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
