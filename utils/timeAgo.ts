/** "сьогодні", "вчора", "4 дн. тому", "2 тиж. тому"... for a time in ms. */
export function timeAgo(ms: number): string {
  const d = Math.floor((Date.now() - ms) / 86400000);
  if (d <= 0) return "сьогодні";
  if (d === 1) return "вчора";
  if (d < 7) return `${d} дн. тому`;
  if (d < 30) return `${Math.floor(d / 7)} тиж. тому`;
  if (d < 365) return `${Math.floor(d / 30)} міс. тому`;
  return `${Math.floor(d / 365)} р. тому`;
}
