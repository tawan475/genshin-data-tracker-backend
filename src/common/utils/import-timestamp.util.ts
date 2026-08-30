/**
 * Coerces one untrusted timestamp candidate into a real `Date`.
 *
 * Accepts what the two sources actually produce: an epoch-milliseconds number
 * (the GOOD payload's own field) or a string holding either epoch milliseconds
 * or a parseable date (the `timestamp` multipart field). Anything else - a
 * boolean, an object, an empty string, a string that does not parse - is `null`
 * so the caller can fall through instead of handing Prisma an `Invalid Date`.
 */
function toTimestamp(value: unknown): Date | null {
  if (value === null || value === undefined) return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  let date: Date;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    date = new Date(value);
  } else if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const numeric = Number(trimmed);
    // Mirrors the multipart handling this replaced: a numeric string is epoch
    // milliseconds, anything else goes to `Date`'s own parser.
    date = Number.isNaN(numeric) ? new Date(trimmed) : new Date(numeric);
  } else {
    return null;
  }

  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Resolves the `createdAt` an imported snapshot should be stored under.
 *
 * Precedence:
 *  1. the `timestamp` multipart field, when the uploader sent one;
 *  2. the GOOD payload's own `timestamp` - irminsul writes epoch milliseconds
 *     into every file it exports (`good.rs`), so scanner builds that predate
 *     the multipart field still get dated by capture rather than by server
 *     receive time, and so still trip the duplicate-timestamp guard when the
 *     same snapshot is uploaded twice;
 *  3. now.
 *
 * Both inputs are untrusted: `/genshin-accounts-public/import-by-key` reaches
 * `processImport` through a bare `JSON.parse` with no DTO validation, so
 * `parsedData.timestamp` can be any JSON value at all.
 */
export function resolveImportTimestamp(
  explicit?: unknown,
  payload?: unknown,
): Date {
  return toTimestamp(explicit) ?? toTimestamp(payload) ?? new Date();
}
