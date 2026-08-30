// `archiver` is ESM-only and would fail to parse under ts-jest's CommonJS
// transform. It arrives here only transitively, via SnapshotExportService,
// which nothing in this suite exercises.
jest.mock('archiver', () => ({ ZipArchive: class {} }));

import * as bcrypt from 'bcrypt';
import { GenshinAccountsService } from './genshin-accounts.service';

/**
 * These specs pin the artifact identity contract:
 *
 *  - the content hash covers only the artifact's *stats*, so re-equipping a
 *    piece must reuse its row and refresh `location` / `lock` / `astralMark`;
 *  - anything inside the hash (levelling) must still mint a brand new row;
 *  - an unchanged re-upload must issue no UPDATE at all.
 *
 * They run against a hand-written in-memory double of the two Prisma models the
 * import touches (no database, and nothing about the code under test is mocked)
 * so the real hashing, dedup and reconciliation paths execute end to end.
 *
 * Two further contracts of the same import path are pinned further down, on the
 * same double: how duplicate hashes collapse, and how a snapshot is dated.
 */

interface ArtifactRow {
  id: number;
  hash: string;
  genshinAccountId: number;
  setKey: string;
  slotKey: string;
  level: number;
  rarity: number;
  mainStatKey: string;
  location: string;
  lock: boolean;
  astralMark: boolean;
  [key: string]: unknown;
}

interface GoodRow {
  artifactIds: number[];
  [key: string]: unknown;
}

type ArtifactInsert = Omit<ArtifactRow, 'id'>;

class FakePrisma {
  artifactRows: ArtifactRow[] = [];
  goods: GoodRow[] = [];
  updateManyCalls: { ids: number[]; data: Partial<ArtifactRow> }[] = [];
  private nextArtifactId = 1;

  account = {
    id: 1,
    userId: 1,
    importKeyHash: bcrypt.hashSync('secret', 4),
  };

  genshinAccount = {
    findUnique: () => Promise.resolve(this.account),
  };

  good = {
    findFirst: () => Promise.resolve(null),
    create: ({ data }: { data: GoodRow }) => {
      this.goods.push(data);
      return Promise.resolve({ id: this.goods.length, ...data });
    },
  };

  accountArtifact = {
    createMany: ({
      data,
      skipDuplicates,
    }: {
      data: ArtifactInsert[];
      skipDuplicates?: boolean;
    }) => {
      let count = 0;
      for (const row of data) {
        const clash = this.artifactRows.find(
          (a) =>
            a.genshinAccountId === row.genshinAccountId && a.hash === row.hash,
        );
        if (clash) {
          // Mirrors @@unique([genshinAccountId, hash]) in the schema.
          if (!skipDuplicates) throw new Error('unique constraint violation');
          continue;
        }
        this.artifactRows.push({ id: this.nextArtifactId++, ...row });
        count++;
      }
      return Promise.resolve({ count });
    },

    findMany: ({
      where,
      select,
    }: {
      where: { genshinAccountId: number; hash: { in: string[] } };
      select: Record<string, boolean>;
    }) => {
      const hashes = where.hash.in;
      const rows = this.artifactRows.filter(
        (a) =>
          a.genshinAccountId === where.genshinAccountId &&
          hashes.includes(a.hash),
      );
      return Promise.resolve(
        rows.map((row) => {
          const picked: Record<string, unknown> = {};
          for (const key of Object.keys(select)) picked[key] = row[key];
          return picked;
        }),
      );
    },

    updateMany: ({
      where,
      data,
    }: {
      where: { genshinAccountId: number; id: { in: number[] } };
      data: Partial<ArtifactRow>;
    }) => {
      const ids = where.id.in;
      this.updateManyCalls.push({ ids: [...ids], data: { ...data } });
      let count = 0;
      for (const row of this.artifactRows) {
        if (row.genshinAccountId !== where.genshinAccountId) continue;
        if (!ids.includes(row.id)) continue;
        Object.assign(row, data);
        count++;
      }
      return Promise.resolve({ count });
    },
  };

  $transaction = <T>(cb: (tx: FakePrisma) => Promise<T>): Promise<T> =>
    cb(this);
}

const fakeDictionary = {
  getId: () => Promise.resolve(1),
  getIdsBulk: () => Promise.resolve(undefined),
  getIdSync: () => 1,
};

const IMPORT_KEY = 'gdt_import_1_secret';

const baseArtifact = {
  setKey: 'GladiatorsFinale',
  slotKey: 'flower',
  level: 20,
  rarity: 5,
  mainStatKey: 'hp',
  location: 'Amber',
  lock: true,
  astralMark: false,
  substats: [
    { key: 'critRate_', value: 3.9 },
    { key: 'atk_', value: 5.8 },
  ],
};

function goodFile(artifacts: any[]) {
  const body = JSON.stringify({
    format: 'GOOD',
    version: 2,
    source: 'test',
    characters: [],
    weapons: [],
    materials: {},
    artifacts,
  });
  return {
    originalname: 'snapshot.json',
    size: Buffer.byteLength(body),
    buffer: Buffer.from(body),
  };
}

describe('artifact import state reconciliation', () => {
  let prisma: FakePrisma;
  let service: GenshinAccountsService;

  const importSnapshot = (artifacts: any[], isoTimestamp: string) =>
    service.importDataByKey(IMPORT_KEY, goodFile(artifacts), isoTimestamp);

  beforeEach(() => {
    prisma = new FakePrisma();
    service = new GenshinAccountsService(
      prisma as any,
      fakeDictionary as any,
      {} as any,
    );
  });

  it('reuses the row and refreshes location/lock when an artifact is re-equipped', async () => {
    await importSnapshot(
      [{ ...baseArtifact, location: 'Amber', lock: true }],
      '2024-01-01T00:00:00.000Z',
    );

    expect(prisma.artifactRows).toHaveLength(1);
    expect(prisma.artifactRows[0].location).toBe('Amber');
    const originalId = prisma.artifactRows[0].id;

    // Same stats, moved to another character and unlocked.
    await importSnapshot(
      [{ ...baseArtifact, location: 'Bennett', lock: false }],
      '2024-01-02T00:00:00.000Z',
    );

    expect(prisma.artifactRows).toHaveLength(1);
    expect(prisma.artifactRows[0].id).toBe(originalId);
    expect(prisma.artifactRows[0].location).toBe('Bennett');
    expect(prisma.artifactRows[0].lock).toBe(false);

    // Both snapshots still point at the same content-addressed row.
    expect(prisma.goods.map((g) => g.artifactIds)).toEqual([
      [originalId],
      [originalId],
    ]);
  });

  it('tracks astralMark the same way', async () => {
    await importSnapshot(
      [{ ...baseArtifact, astralMark: false }],
      '2024-01-01T00:00:00.000Z',
    );
    await importSnapshot(
      [{ ...baseArtifact, astralMark: true }],
      '2024-01-02T00:00:00.000Z',
    );

    expect(prisma.artifactRows).toHaveLength(1);
    expect(prisma.artifactRows[0].astralMark).toBe(true);
  });

  // The empty-string case: a falsy desired value must still be written, which
  // is exactly what a truthiness check would drop.
  it('clears location when the artifact is unequipped', async () => {
    await importSnapshot(
      [{ ...baseArtifact, location: 'Amber' }],
      '2024-01-01T00:00:00.000Z',
    );

    // The scanner sends "" for a piece sitting in the inventory.
    await importSnapshot(
      [{ ...baseArtifact, location: '' }],
      '2024-01-02T00:00:00.000Z',
    );
    expect(prisma.artifactRows[0].location).toBe('');

    // A payload that omits the field entirely must not resurrect the old value,
    // and must not count as a change either.
    prisma.updateManyCalls = [];
    const withoutLocation: Record<string, unknown> = { ...baseArtifact };
    delete withoutLocation.location;
    await importSnapshot([withoutLocation], '2024-01-03T00:00:00.000Z');
    expect(prisma.artifactRows[0].location).toBe('');
    expect(prisma.updateManyCalls).toEqual([]);
  });

  it('writes nothing when an unchanged inventory is re-uploaded', async () => {
    await importSnapshot([baseArtifact], '2024-01-01T00:00:00.000Z');
    prisma.updateManyCalls = [];

    await importSnapshot([baseArtifact], '2024-01-02T00:00:00.000Z');
    await importSnapshot([baseArtifact], '2024-01-03T00:00:00.000Z');

    expect(prisma.updateManyCalls).toEqual([]);
    expect(prisma.artifactRows).toHaveLength(1);
  });

  it('mints a new row when a hashed field (level) changes', async () => {
    await importSnapshot(
      [{ ...baseArtifact, level: 16 }],
      '2024-01-01T00:00:00.000Z',
    );
    await importSnapshot(
      [{ ...baseArtifact, level: 20 }],
      '2024-01-02T00:00:00.000Z',
    );

    expect(prisma.artifactRows).toHaveLength(2);
    expect(prisma.artifactRows.map((a) => a.level).sort()).toEqual([16, 20]);
    expect(prisma.goods[0].artifactIds).not.toEqual(
      prisma.goods[1].artifactIds,
    );
  });

  it('batches one update per distinct target state, not one per artifact', async () => {
    const pieces = ['flower', 'plume', 'sands', 'goblet', 'circlet'].map(
      (slotKey) => ({ ...baseArtifact, slotKey, location: 'Amber' }),
    );
    await importSnapshot(pieces, '2024-01-01T00:00:00.000Z');
    prisma.updateManyCalls = [];

    await importSnapshot(
      pieces.map((p) => ({ ...p, location: 'Bennett' })),
      '2024-01-02T00:00:00.000Z',
    );

    expect(prisma.updateManyCalls).toHaveLength(1);
    expect(prisma.updateManyCalls[0].ids).toHaveLength(5);
    expect(prisma.updateManyCalls[0].data).toEqual({
      location: 'Bennett',
      lock: true,
      astralMark: false,
    });
    expect(prisma.artifactRows.every((a) => a.location === 'Bennett')).toBe(
      true,
    );
  });

  // The bulk path threads a cross-file cache through processImport so repeated
  // snapshots do not re-query rows. That cache now carries the mutable state as
  // well as the id, so it has to stay honest about both.
  it('still sees a re-equip across files of one bulk import', async () => {
    await service.importBulkData(
      1,
      1,
      [
        goodFile([{ ...baseArtifact, location: 'Amber' }]),
        goodFile([{ ...baseArtifact, location: 'Bennett' }]),
      ],
      ['2024-01-01T00:00:00.000Z', '2024-01-02T00:00:00.000Z'],
    );

    expect(prisma.artifactRows).toHaveLength(1);
    expect(prisma.artifactRows[0].location).toBe('Bennett');
  });

  // Phase 2 of a bulk import runs up to IMPORT_CONCURRENCY_LIMIT (10) imports
  // of the same account at once. If every file reconciled, the stored value
  // would be whichever of those transactions committed last - an arbitrary,
  // often older, snapshot - and overlapping UPDATE id sets would race in
  // different orders. Only the newest file may settle live state, and it runs
  // last and alone.
  it('lets only the newest file of a bulk import settle the live state', async () => {
    await service.importBulkData(
      1,
      1,
      [
        goodFile([{ ...baseArtifact, location: 'Amber' }]),
        goodFile([{ ...baseArtifact, location: 'Bennett' }]),
        goodFile([{ ...baseArtifact, location: 'Klee' }]),
      ],
      [
        '2024-01-01T00:00:00.000Z',
        '2024-01-02T00:00:00.000Z',
        '2024-01-03T00:00:00.000Z',
      ],
    );

    // Every file is still imported as a snapshot...
    expect(prisma.goods).toHaveLength(3);
    // ...but only the newest one wrote the shared row's live state.
    expect(prisma.artifactRows).toHaveLength(1);
    expect(prisma.artifactRows[0].location).toBe('Klee');
    expect(prisma.updateManyCalls.map((c) => c.data.location)).toEqual([
      'Klee',
    ]);
  });

  it('does not write through the bulk cache when nothing moved', async () => {
    await service.importBulkData(
      1,
      1,
      [goodFile([baseArtifact]), goodFile([baseArtifact])],
      ['2024-01-01T00:00:00.000Z', '2024-01-02T00:00:00.000Z'],
    );

    expect(prisma.artifactRows).toHaveLength(1);
    expect(prisma.updateManyCalls).toEqual([]);
  });
});

/**
 * Stat-identical pieces (level-0 fodder with one substat, most of all) collapse
 * onto a single content-addressed row, so one live state has to win. It must not
 * be "whichever came first in the uploaded array": irminsul builds that array by
 * iterating a HashMap, so its order changes between runs, and an order-dependent
 * winner would rewrite the shared row on every otherwise-unchanged upload.
 */
describe('duplicate-hash collapse', () => {
  let prisma: FakePrisma;
  let service: GenshinAccountsService;

  const importSnapshot = (artifacts: any[], isoTimestamp: string) =>
    service.importDataByKey(IMPORT_KEY, goodFile(artifacts), isoTimestamp);

  beforeEach(() => {
    prisma = new FakePrisma();
    service = new GenshinAccountsService(
      prisma as any,
      fakeDictionary as any,
      {} as any,
    );
  });

  // Same stats, so one row - but one copy is equipped and locked and the other
  // is loose fodder.
  const equipped = {
    ...baseArtifact,
    location: 'Amber',
    lock: true,
    astralMark: false,
  };
  const loose = {
    ...baseArtifact,
    location: '',
    lock: false,
    astralMark: true,
  };

  it('merges the duplicates instead of taking the first occurrence', async () => {
    await importSnapshot([equipped, loose], '2024-01-01T00:00:00.000Z');

    expect(prisma.artifactRows).toHaveLength(1);
    expect(prisma.artifactRows[0]).toMatchObject({
      location: 'Amber',
      lock: true,
      astralMark: true,
    });
    // The INSERT already carries the merged state, so nothing has to be
    // corrected straight after it.
    expect(prisma.updateManyCalls).toEqual([]);
  });

  it('reaches the same row state whichever order the duplicates arrive in', async () => {
    await importSnapshot([equipped, loose], '2024-01-01T00:00:00.000Z');
    const settled = { ...prisma.artifactRows[0] };
    prisma.updateManyCalls = [];

    // Re-upload of the very same inventory, with the array walked the other way.
    await importSnapshot([loose, equipped], '2024-01-02T00:00:00.000Z');

    expect(prisma.artifactRows).toHaveLength(1);
    expect(prisma.artifactRows[0]).toEqual(settled);
    // The zero-write property the dedup design rests on.
    expect(prisma.updateManyCalls).toEqual([]);
  });

  it('settles two different locations deterministically', async () => {
    await importSnapshot(
      [
        { ...baseArtifact, location: 'Klee' },
        { ...baseArtifact, location: 'Amber' },
      ],
      '2024-01-01T00:00:00.000Z',
    );
    expect(prisma.artifactRows[0].location).toBe('Amber');
    prisma.updateManyCalls = [];

    await importSnapshot(
      [
        { ...baseArtifact, location: 'Amber' },
        { ...baseArtifact, location: 'Klee' },
      ],
      '2024-01-02T00:00:00.000Z',
    );
    expect(prisma.artifactRows[0].location).toBe('Amber');
    expect(prisma.updateManyCalls).toEqual([]);
  });
});

/**
 * Snapshots are dated by capture, not by server receive time. irminsul builds
 * shipped before the multipart `timestamp` field existed still stamp the GOOD
 * payload itself, so that is the fallback - otherwise those uploads land at
 * "now" and slip past the duplicate-timestamp guard.
 */
describe('snapshot timestamp resolution', () => {
  let prisma: FakePrisma;
  let service: GenshinAccountsService;

  beforeEach(() => {
    prisma = new FakePrisma();
    service = new GenshinAccountsService(
      prisma as any,
      fakeDictionary as any,
      {} as any,
    );
  });

  const importPayload = (
    extra: Record<string, unknown>,
    timestamp?: string,
  ) => {
    const body = JSON.stringify({
      format: 'GOOD',
      version: 3,
      source: 'Irminsul',
      characters: [],
      weapons: [],
      materials: {},
      artifacts: [],
      ...extra,
    });
    const file = {
      originalname: 'snapshot.json',
      size: Buffer.byteLength(body),
      buffer: Buffer.from(body),
    };
    return service.importDataByKey(IMPORT_KEY, file, timestamp);
  };

  const storedAt = () => prisma.goods[0].createdAt as Date;

  it('falls back to the GOOD payload timestamp (epoch ms) when none was sent', async () => {
    await importPayload({ timestamp: 1704067200000 });
    expect(storedAt().toISOString()).toBe('2024-01-01T00:00:00.000Z');
  });

  it('accepts a payload timestamp sent as a string', async () => {
    await importPayload({ timestamp: '2024-03-04T05:06:07.000Z' });
    expect(storedAt().toISOString()).toBe('2024-03-04T05:06:07.000Z');
  });

  it('prefers the uploaded timestamp field over the payload', async () => {
    await importPayload(
      { timestamp: 1704067200000 },
      '2024-06-01T00:00:00.000Z',
    );
    expect(storedAt().toISOString()).toBe('2024-06-01T00:00:00.000Z');
  });

  it('uses receive time when the payload carries no timestamp', async () => {
    const before = Date.now();
    await importPayload({});
    expect(storedAt().getTime()).toBeGreaterThanOrEqual(before);
  });

  // import-by-key runs a bare JSON.parse with no DTO validation, so the field
  // can hold anything; it must never reach Prisma as an Invalid Date.
  it.each([['banana'], [{}], [true], [''], [null]])(
    'ignores an unusable payload timestamp (%p)',
    async (value) => {
      const before = Date.now();
      await importPayload({ timestamp: value });
      const at = storedAt();
      expect(Number.isNaN(at.getTime())).toBe(false);
      expect(at.getTime()).toBeGreaterThanOrEqual(before);
    },
  );
});
/**
 * The other half of the cross-repo GOOD contract.
 *
 * `irminsul/src/good.rs` pins the *names* it writes (see
 * `good_json_keys_match_what_the_tracker_reads`); this pins the names the
 * importer reads back. Both are needed, because `import-by-key` runs a bare
 * `JSON.parse` and pulls fields by name with no schema and no error on a miss:
 * every mismatch here is silent data loss, not a failed upload. The historical
 * trap is `gi_achievements` -- the one field irminsul does *not* camelCase.
 */
describe('irminsul GOOD payload field names', () => {
  let prisma: FakePrisma;
  let service: GenshinAccountsService;
  // (type, key) -> id, so the assertions below can tell which raw key the
  // importer actually looked up rather than seeing every key pack to 1.
  let dictionaryLookups: string[];

  const recordingDictionary = () => {
    const ids = new Map<string, number>();
    const idFor = (type: string, rawKey: string) => {
      const slot = `${type}:${rawKey}`;
      dictionaryLookups.push(slot);
      if (!ids.has(slot)) ids.set(slot, ids.size + 10);
      return ids.get(slot)!;
    };
    return {
      getId: (type: string, rawKey: string) =>
        Promise.resolve(idFor(type, rawKey)),
      getIdsBulk: () => Promise.resolve(undefined),
      getIdSync: (type: string, rawKey: string) => idFor(type, rawKey),
    };
  };

  beforeEach(() => {
    prisma = new FakePrisma();
    dictionaryLookups = [];
    service = new GenshinAccountsService(
      prisma as any,
      recordingDictionary() as any,
      {} as any,
    );
  });

  // Exactly the shape `Good` serializes to in irminsul/src/good.rs.
  const irminsulPayload = {
    format: 'GOOD',
    version: 3,
    source: 'Irminsul',
    characters: [
      {
        key: 'HuTao',
        level: 90,
        constellation: 1,
        ascension: 6,
        talent: { auto: 10, skill: 9, burst: 8 },
      },
    ],
    weapons: [
      {
        key: 'StaffOfHoma',
        level: 90,
        ascension: 6,
        refinement: 1,
        location: 'HuTao',
        lock: true,
      },
    ],
    materials: { ChilledMeat: 12 },
    artifacts: [
      {
        setKey: 'GladiatorsFinale',
        slotKey: 'flower',
        level: 20,
        rarity: 5,
        mainStatKey: 'hp',
        location: 'HuTao',
        lock: true,
        substats: [{ key: 'critRate_', value: 3.9, initialValue: 3.9 }],
        totalRolls: 5,
        astralMark: false,
        elixerCrafted: false,
        unactivatedSubstats: [],
      },
    ],
    gi_achievements: [80001, 80002],
    timestamp: 1704067200000,
  };

  const importPayload = (payload: Record<string, unknown>) => {
    const body = JSON.stringify(payload);
    return service.importDataByKey(IMPORT_KEY, {
      originalname: 'irminsul_capture.json',
      size: Buffer.byteLength(body),
      buffer: Buffer.from(body),
    });
  };

  it('reads every section of a real irminsul export', async () => {
    await importPayload(irminsulPayload);

    const snapshot = prisma.goods[0];
    expect(snapshot.format).toBe('GOOD');
    expect(snapshot.version).toBe(3);
    expect(snapshot.source).toBe('Irminsul');
    // The payload's own epoch-ms timestamp, since no multipart field was sent.
    expect((snapshot.createdAt as Date).toISOString()).toBe(
      '2024-01-01T00:00:00.000Z',
    );

    // Character keys are interned, and the packed row is
    // [dictId, level, ascension, constellation, auto, skill, burst] per
    // CHARACTER_SCHEMA -- proof `talent.auto`/`skill`/`burst` were all found.
    expect(dictionaryLookups).toContain('CHARACTER:HuTao');
    const packedCharacters = snapshot.characters as Record<string, number[]>;
    expect(Object.values(packedCharacters)[0].slice(1)).toEqual([
      90, 6, 1, 10, 9, 8,
    ]);

    // WEAPON_SCHEMA: [dictId, level, ascension, refinement, locationId, lock].
    expect(dictionaryLookups).toContain('WEAPON:StaffOfHoma');
    const packedWeapons = snapshot.weapons as number[][];
    expect(packedWeapons[0].slice(1, 4)).toEqual([90, 6, 1]);
    expect(packedWeapons[0][5]).toBe(1);

    expect(dictionaryLookups).toContain('MATERIAL:ChilledMeat');
    expect(Object.values(snapshot.materials as Record<string, number>)).toEqual(
      [12],
    );

    // The field irminsul leaves snake_case.
    expect(snapshot.achievements).toEqual([80001, 80002]);

    expect(snapshot.artifactIds).toHaveLength(1);
    const artifact = prisma.artifactRows[0];
    expect(artifact.setKey).toBe('GladiatorsFinale');
    expect(artifact.slotKey).toBe('flower');
    expect(artifact.mainStatKey).toBe('hp');
    expect(artifact.level).toBe(20);
    expect(artifact.rarity).toBe(5);
    expect(artifact.location).toBe('HuTao');
    expect(artifact.lock).toBe(true);
    expect(artifact.totalRolls).toBe(5);
    // cv = 2 * critRate_; a zero here means `substats` or its `value` was
    // read under the wrong name.
    expect(artifact.cv).toBeCloseTo(7.8);
  });

  // Everything but the field under test, so the two spellings are exercised on
  // an otherwise complete payload.
  const withoutGiAchievements = () => {
    const rest: Record<string, unknown> = { ...irminsulPayload };
    delete rest.gi_achievements;
    return rest;
  };

  it('still accepts a plain `achievements` array from other GOOD producers', async () => {
    await importPayload({
      ...withoutGiAchievements(),
      achievements: [1, 2, 3],
    });
    expect(prisma.goods[0].achievements).toEqual([1, 2, 3]);
  });

  it('stores no achievements when neither spelling is present', async () => {
    await importPayload(withoutGiAchievements());
    expect(prisma.goods[0].achievements).toEqual([]);
  });
});
