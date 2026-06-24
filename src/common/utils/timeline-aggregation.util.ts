export type TimelineGroupBy = 'hour' | 'day' | 'month' | 'year';

function periodKey(date: Date, groupBy: TimelineGroupBy): string {
  switch (groupBy) {
    case 'year':
      return `${date.getUTCFullYear()}`;
    case 'month':
      return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    case 'hour':
      return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')} ${String(date.getUTCHours()).padStart(2, '0')}:00`;
    case 'day':
    default:
      return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
  }
}

function alignPeriodStart(date: Date, groupBy: TimelineGroupBy): Date {
  switch (groupBy) {
    case 'year':
      return new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    case 'month':
      return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
    case 'hour':
      return new Date(
        Date.UTC(
          date.getUTCFullYear(),
          date.getUTCMonth(),
          date.getUTCDate(),
          date.getUTCHours(),
        ),
      );
    case 'day':
    default:
      return new Date(
        Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
      );
  }
}

function advancePeriod(date: Date, groupBy: TimelineGroupBy): void {
  switch (groupBy) {
    case 'year':
      date.setUTCFullYear(date.getUTCFullYear() + 1);
      break;
    case 'month':
      date.setUTCMonth(date.getUTCMonth() + 1);
      break;
    case 'hour':
      date.setUTCHours(date.getUTCHours() + 1);
      break;
    case 'day':
    default:
      date.setUTCDate(date.getUTCDate() + 1);
      break;
  }
}

export interface TimelinePoint<T> {
  timestamp: Date;
  value: T;
}

export function aggregateTimelineByGroup<T>(
  points: TimelinePoint<T>[],
  groupBy: TimelineGroupBy,
  limit: number,
): TimelinePoint<T>[] {
  if (points.length === 0) return [];

  const grouped = new Map<string, TimelinePoint<T>>();
  for (const point of points) {
    grouped.set(periodKey(point.timestamp, groupBy), point);
  }

  let current = alignPeriodStart(new Date(points[0].timestamp), groupBy);
  const end = new Date();
  let lastKnown = points[0];
  const aggregated: TimelinePoint<T>[] = [];

  while (current <= end) {
    const key = periodKey(current, groupBy);
    if (grouped.has(key)) {
      lastKnown = grouped.get(key)!;
    }
    aggregated.push({
      timestamp: new Date(current),
      value: lastKnown.value,
    });
    advancePeriod(current, groupBy);
  }

  return aggregated.slice(-limit);
}

export function formatMaterialDisplayName(key: string): string {
  return key.replace(/([A-Z])/g, ' $1').trim();
}
