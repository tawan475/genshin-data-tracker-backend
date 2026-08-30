export const MAX_SUBSTATS: Record<string, number> = {
  "hp": 298.75,
  "hp_": 5.83,
  "atk": 19.45,
  "atk_": 5.83,
  "def": 23.15,
  "def_": 7.29,
  "eleMas": 23.31,
  "enerRech_": 6.48,
  "critRate_": 3.89,
  "critDMG_": 7.77
};

export function calculateCV(substats: { key: string; value: number }[]): number {
  let cv = 0;
  for (const s of substats || []) {
    if (s.key === "critRate_") cv += (s.value * 2);
    if (s.key === "critDMG_") cv += s.value;
  }
  return Number(cv.toFixed(2));
}

export function calculateRV(substats: { key: string; value: number }[]): number {
  let rv = 0;
  for (const s of substats || []) {
    const maxVal = MAX_SUBSTATS[s.key];
    if (maxVal && s.value) {
      rv += (s.value / maxVal) * 100;
    }
  }
  return Math.round(rv / 10) * 10;
}

/**
 * Live, user-mutable state of an artifact.
 *
 * The content hash that identifies an `AccountArtifact` row deliberately covers
 * only the artifact's identity (setKey / slotKey / rarity / level / mainStatKey
 * / substats) so that repeated snapshots of an unchanged inventory reuse the
 * same rows. These columns are *not* part of that hash: they change while the
 * artifact itself stays the same row, so every import has to refresh them
 * instead of leaving whatever value happened to be written when the row was
 * first inserted.
 *
 * Note the flip side: anything inside the hash (levelling an artifact, rolling
 * a new substat) intentionally mints a *new* row and must not be handled here.
 *
 * Readers beware: because these columns are refreshed by every import, they
 * describe the inventory as of the *newest* snapshot, not as of the snapshot
 * whose `artifactIds` you followed to reach the row. Anything that renders a
 * historical snapshot (`SnapshotExportService.buildGoodExport`,
 * `GenshinAccountsService.getMonthlyAnalysis`) is therefore showing current
 * state; see the comments at those two call sites.
 */
export interface ArtifactMutableState {
  location: string;
  lock: boolean;
  astralMark: boolean;
}

/**
 * Normalises the mutable state out of one raw uploaded artifact.
 *
 * Must stay byte-identical to how the same columns are normalised when a row is
 * first inserted, otherwise every import would see a spurious difference and
 * rewrite rows that never changed.
 */
export function toArtifactMutableState(raw: {
  location?: unknown;
  lock?: unknown;
  astralMark?: unknown;
}): ArtifactMutableState {
  return {
    // `/genshin-accounts-public/import-by-key` hands us a raw JSON.parse of an
    // uploaded file with no DTO validation, so a non-string `location` is
    // reachable. It used to only be able to blow up the INSERT; it now also
    // reaches an UPDATE, so coerce it here rather than handing Prisma a value
    // the column cannot hold.
    location: typeof raw.location === 'string' ? raw.location : '',
    lock: Boolean(raw.lock),
    astralMark: Boolean(raw.astralMark),
  };
}

/**
 * Collapses the live state of two artifacts that share one content hash.
 *
 * Stat-identical pieces (routine for level-0 3-star / 4-star fodder with a single
 * substat) are one row, so one of their states has to win. Picking the first
 * occurrence would make the winner depend on the order of the uploaded
 * `artifacts` array, which is not stable - irminsul builds it by iterating a
 * `HashMap` - so a pair that differs only in `lock` would rewrite the shared row
 * on every upload, turning "unchanged inventory costs zero writes" into churn
 * and jittering the `!lock && location === ''` fodder count.
 *
 * Merging is commutative and associative, so the result depends only on the
 * *set* of duplicates, never on their order, and it says what a user means:
 * if any copy is locked/marked the row is locked/marked, and an equipped copy
 * beats one sitting in the inventory. Two different non-empty locations are
 * settled lexicographically - arbitrary, but stable.
 */
export function mergeArtifactMutableState(
  a: ArtifactMutableState,
  b: ArtifactMutableState,
): ArtifactMutableState {
  let location: string;
  if (!a.location) location = b.location;
  else if (!b.location) location = a.location;
  else location = a.location <= b.location ? a.location : b.location;

  return {
    location,
    lock: a.lock || b.lock,
    astralMark: a.astralMark || b.astralMark,
  };
}

/** A batched write: one distinct target state applied to many artifact rows. */
export interface ArtifactStateUpdate extends ArtifactMutableState {
  ids: number[];
}

/** A resolved artifact row: its id plus the state currently stored for it. */
export interface ArtifactCacheEntry extends ArtifactMutableState {
  id: number;
  hash: string;
}

/**
 * hash -> resolved row, shared across the files of one bulk import so repeated
 * snapshots do not re-query rows that were already looked up.
 */
export type ArtifactImportCache = Map<string, ArtifactCacheEntry>;

/** Callback that persists one chunk of ids. Keeps this util Prisma-free. */
export type ArtifactStateWriter = (
  ids: number[],
  state: ArtifactMutableState,
) => Promise<unknown>;

/** Rows are updated in chunks so the `IN (...)` list stays a sane size. */
export const ARTIFACT_STATE_CHUNK_SIZE = 500;

export function isSameArtifactState(
  a: ArtifactMutableState,
  b: ArtifactMutableState,
): boolean {
  return (
    a.location === b.location &&
    a.lock === b.lock &&
    a.astralMark === b.astralMark
  );
}

/**
 * Collapse "row X should now be at state Y" into the smallest set of batched
 * updates: one per distinct target state, and nothing at all for rows that
 * already match. An unchanged inventory therefore costs zero writes, which is
 * what keeps bulk imports cheap.
 */
export function buildArtifactStateUpdates(
  rows: Iterable<{
    id: number;
    current: ArtifactMutableState;
    desired: ArtifactMutableState;
  }>,
): ArtifactStateUpdate[] {
  const groups = new Map<string, ArtifactStateUpdate>();

  for (const row of rows) {
    if (isSameArtifactState(row.current, row.desired)) continue;

    const { location, lock, astralMark } = row.desired;
    const groupKey = `${lock ? 1 : 0}|${astralMark ? 1 : 0}|${location}`;
    let group = groups.get(groupKey);
    if (!group) {
      group = { location, lock, astralMark, ids: [] };
      groups.set(groupKey, group);
    }
    group.ids.push(row.id);
  }

  const updates = Array.from(groups.values());
  for (const update of updates) {
    update.ids.sort((a, b) => a - b);
  }
  // Deterministic statement order (lowest id first), mirroring the hash-sorted
  // inserts, so concurrent imports of the same account take row locks in a
  // consistent order.
  updates.sort((a, b) => a.ids[0] - b.ids[0]);

  return updates;
}

/** Applies `buildArtifactStateUpdates` output through the caller's writer. */
export async function applyArtifactStateUpdates(
  updates: ArtifactStateUpdate[],
  write: ArtifactStateWriter,
): Promise<number> {
  let written = 0;

  for (const { ids, ...state } of updates) {
    for (let i = 0; i < ids.length; i += ARTIFACT_STATE_CHUNK_SIZE) {
      await write(ids.slice(i, i + ARTIFACT_STATE_CHUNK_SIZE), state);
      written += Math.min(ARTIFACT_STATE_CHUNK_SIZE, ids.length - i);
    }
  }

  return written;
}
