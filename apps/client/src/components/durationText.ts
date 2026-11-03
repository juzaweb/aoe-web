/**
 * Compact duration for upgrade timers (LVL2).
 *
 * The new curve ends at 73 hours, so seconds-only stopped being readable: a
 * level-99 Town Center is 263,609,355 ms, which the old `${(ms / 1000).toFixed(1)}s`
 * rendered as `263609.4s`. The four shapes here are `45s`, `12m`, `6h42` and
 * `73h`, dropping a zero minute part so an exact hour does not read as `73h0`.
 *
 * Rounds down, like a countdown: showing `1m` while 59.4 s remain would oversell
 * progress.
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0s';

  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;

  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes}m`;

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours}h${minutes}` : `${hours}h`;
}
