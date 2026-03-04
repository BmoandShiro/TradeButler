/**
 * Sample a time-series array to at most maxPoints for readable charts.
 * When data.length <= maxPoints, returns the same array; otherwise picks evenly spaced points.
 */
export function sampleTimeSeries<T>(data: T[], maxPoints: number): T[] {
  if (data.length <= maxPoints) return data;
  const step = (data.length - 1) / (maxPoints - 1);
  const result: T[] = [];
  for (let i = 0; i < maxPoints; i++) {
    const index = i === maxPoints - 1 ? data.length - 1 : Math.round(i * step);
    result.push(data[index]);
  }
  return result;
}

/** Suggested max points for line charts to stay readable (fewer ticks, less clutter). */
export const CHART_MAX_POINTS = 72;

/** Minimum data points before showing the Brush (scroll) on a chart. */
export const BRUSH_MIN_POINTS = 24;

/** XAxis interval to show ~8–10 ticks: interval between displayed ticks. */
export function xAxisInterval(dataLength: number, desiredTicks: number = 10): number {
  if (dataLength <= desiredTicks) return 0;
  return Math.floor(dataLength / desiredTicks);
}
