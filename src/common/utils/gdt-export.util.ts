export function formatGdtTimestamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

/** First YYYY-MM-DD + T/_ + HH-mm-ss or HH:mm:ss embedded in a filename */
const FILENAME_TIMESTAMP_RE =
  /(\d{4}-\d{2}-\d{2})[T_](\d{2})[-:](\d{2})[-:](\d{2})/;

export function parseFilenameTimestamp(filename: string): Date | null {
  const match = filename.match(FILENAME_TIMESTAMP_RE);
  if (!match) return null;

  const [, datePart, hour, minute, second] = match;
  const separator = filename[match.index! + datePart.length];
  const timePart = match[0].slice(datePart.length + 1);
  const isoTime = `${hour}:${minute}:${second}`;

  // GDT exports encode UTC with dashes in the time segment (e.g. 2026-06-24T15-30-52)
  const date =
    separator === 'T' && timePart.includes('-')
      ? new Date(`${datePart}T${isoTime}Z`)
      : new Date(`${datePart}T${isoTime}`);

  return isNaN(date.getTime()) ? null : date;
}

export function gdtExportFilename(createdAt: Date, snapshotId?: number): string {
  const base = `GDT_export-${formatGdtTimestamp(createdAt)}`;
  return snapshotId != null ? `${base}-${snapshotId}.json` : `${base}.json`;
}

export function gdtBulkExportFilename(startedAt: Date): string {
  return `GDT_bulk_export-${formatGdtTimestamp(startedAt)}.zip`;
}

export function uniqueEntryNames(
  entries: { createdAt: Date; id: number }[],
): Map<number, string> {
  const used = new Set<string>();
  const result = new Map<number, string>();

  for (const entry of entries) {
    let name = gdtExportFilename(entry.createdAt);
    if (used.has(name)) {
      name = gdtExportFilename(entry.createdAt, entry.id);
    }
    used.add(name);
    result.set(entry.id, name);
  }

  return result;
}
