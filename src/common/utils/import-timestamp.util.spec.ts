import { resolveImportTimestamp } from './import-timestamp.util';

/**
 * `processImport` used to date every snapshot `timestamp ? new Date(timestamp) : new Date()`,
 * so an irminsul build that predates the multipart `timestamp` field got server
 * receive time - a value that is different on every upload, which also meant the
 * duplicate-timestamp guard in `processImport` never fired for those clients.
 * These cover the fallback that fixed it, and the untrusted-input handling it
 * needs because `/genshin-accounts-public/import-by-key` reaches this through a
 * bare `JSON.parse` with no DTO validation.
 */
describe('resolveImportTimestamp', () => {
  const CAPTURE_MS = 1_700_000_000_000;
  const PAYLOAD_MS = 1_600_000_000_000;

  const assertIsRoughlyNow = (value: Date) => {
    expect(value.getTime()).toBeGreaterThanOrEqual(Date.now() - 60_000);
    expect(value.getTime()).toBeLessThanOrEqual(Date.now() + 1_000);
  };

  it('prefers the uploader-supplied timestamp over the payload', () => {
    expect(resolveImportTimestamp(String(CAPTURE_MS), PAYLOAD_MS)).toEqual(
      new Date(CAPTURE_MS),
    );
  });

  it('accepts an ISO date string from the uploader', () => {
    expect(resolveImportTimestamp('2026-01-02T03:04:05.000Z')).toEqual(
      new Date('2026-01-02T03:04:05.000Z'),
    );
  });

  it('falls back to the GOOD payload timestamp when the field is absent', () => {
    // The whole point of the fallback: already-shipped scanner builds send no
    // `timestamp` part, but every file irminsul writes carries epoch ms.
    expect(resolveImportTimestamp(undefined, PAYLOAD_MS)).toEqual(
      new Date(PAYLOAD_MS),
    );
  });

  it('accepts a numeric string in the payload too', () => {
    expect(resolveImportTimestamp(undefined, String(PAYLOAD_MS))).toEqual(
      new Date(PAYLOAD_MS),
    );
  });

  it.each([
    ['an empty string', ''],
    ['whitespace', '   '],
    ['an unparseable string', 'not a date'],
    ['null', null],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])(
    'falls through to the payload when the field is %s',
    (_label, explicit) => {
      expect(resolveImportTimestamp(explicit, PAYLOAD_MS)).toEqual(
        new Date(PAYLOAD_MS),
      );
    },
  );

  it.each([
    ['an object', { seconds: 1 }],
    ['an array', [PAYLOAD_MS]],
    ['a boolean', true],
    ['an unparseable string', 'yesterday'],
    ['missing', undefined],
  ])(
    'falls through to now when the payload timestamp is %s',
    (_label, payload) => {
      assertIsRoughlyNow(resolveImportTimestamp(undefined, payload));
    },
  );

  it('never returns an Invalid Date, which Prisma would reject', () => {
    for (const value of [
      '',
      'nope',
      {},
      [],
      true,
      Number.NaN,
      null,
      undefined,
    ]) {
      expect(Number.isNaN(resolveImportTimestamp(value, value).getTime())).toBe(
        false,
      );
    }
  });

  it('returns now when neither source supplies one', () => {
    assertIsRoughlyNow(resolveImportTimestamp());
  });

  it('passes a Date through unchanged', () => {
    const date = new Date(CAPTURE_MS);
    expect(resolveImportTimestamp(date)).toEqual(date);
  });
});
