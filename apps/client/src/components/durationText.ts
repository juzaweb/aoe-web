/**
 * Compact duration for upgrade timers (LVL2).
 *
 * The ten-level ladder ends at 13h40 for the Town Center, so seconds-only is
 * unreadable long before that: a raw `${(ms / 1000).toFixed(1)}s` renders the
 * last step as `49207.5s`. The four shapes here are `45s`, `12m`, `6h42` and
 * `13h40`, dropping a zero minute part so an exact hour does not read as `13h0`.
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
