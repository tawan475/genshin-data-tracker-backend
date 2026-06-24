export function formatGdtTimestamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-').slice(0, 19);
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
