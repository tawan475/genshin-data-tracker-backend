// `archiver` is ESM-only and would fail to parse under ts-jest's CommonJS
// transform. Nothing in this suite builds a zip.
jest.mock('archiver', () => ({ ZipArchive: class {} }));

import { AccountArtifact, Good } from '@prisma/client';
import { DictionaryService } from '../dictionary/dictionary.service';
import { PrismaService } from '../prisma.service';
import { SnapshotExportService } from './snapshot-export.service';

/**
 * Pins the documented limitation of `buildGoodExport`: an exported snapshot's
 * `location` / `lock` / `astralMark` are read from the shared, content-addressed
 * `AccountArtifact` row, so they are the CURRENT inventory state rather than the
 * state at capture time. Everything else in the payload is frozen per snapshot.
 *
 * This is deliberate for now (per-snapshot state would have to be persisted on
 * `Good`, a schema change - audit note `r-backend` #1). The test exists so that
 * whoever does persist it cannot land it without noticing that this reader has
 * to switch over too.
 */
describe('SnapshotExportService.buildGoodExport', () => {
  const dictionaryService = {
    getKey: () => null,
  } as unknown as DictionaryService;
  const service = new SnapshotExportService(
    {} as PrismaService,
    dictionaryService,
  );

  const good: Good = {
    id: 1,
    format: 'GOOD',
    version: 3,
    source: 'Irminsul',
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    isDeleted: false,
    deletedAt: null,
    fileSize: 0,
    compressedFileSize: 0,
    characters: {},
    weapons: [],
    materials: {},
    achievements: [],
    artifactIds: [7],
    genshinAccountId: 1,
  };

  const artifactRow: AccountArtifact = {
    id: 7,
    hash: 'deadbeef',
    genshinAccountId: 1,
    setKey: 'GladiatorsFinale',
    slotKey: 'flower',
    level: 20,
    rarity: 5,
    mainStatKey: 'hp',
    location: 'Amber',
    lock: true,
    totalRolls: 0,
    astralMark: false,
    elixerCrafted: false,
    substats: [{ key: 'critRate_', value: 3.9 }],
    cv: 7.8,
    rv: 100,
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
  };

  it('copies the stats stored for the snapshot', () => {
    const { payload, createdAt } = service.buildGoodExport(
      good,
      new Map([[7, artifactRow]]),
    );

    expect(createdAt).toEqual(good.createdAt);
    expect(payload.artifacts).toEqual([
      {
        setKey: 'GladiatorsFinale',
        slotKey: 'flower',
        level: 20,
        rarity: 5,
        mainStatKey: 'hp',
        location: 'Amber',
        lock: true,
        substats: [{ key: 'critRate_', value: 3.9 }],
      },
    ]);
  });

  it('renders live location/lock, so a later import changes an old export', () => {
    // The same historical snapshot, but the shared row has since been
    // re-equipped and unlocked by a newer upload.
    const { payload } = service.buildGoodExport(
      good,
      new Map([[7, { ...artifactRow, location: 'Bennett', lock: false }]]),
    );

    expect(payload.artifacts).toEqual([
      expect.objectContaining({ location: 'Bennett', lock: false }),
    ]);
  });

  it('skips artifact ids whose row has been deleted', () => {
    const { payload } = service.buildGoodExport(good, new Map());
    expect(payload.artifacts).toEqual([]);
  });
});
