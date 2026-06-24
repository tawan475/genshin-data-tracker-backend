function parseIntEnv(value: string | undefined, fallback: number): number {
  if (value == null || value === '') return fallback;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function parseFloatEnv(value: string | undefined, fallback: number): number {
  if (value == null || value === '') return fallback;
  const parsed = parseFloat(value);
  return Number.isNaN(parsed) ? fallback : parsed;
}

export const exportConfig = {
  asyncThreshold: parseIntEnv(process.env.EXPORT_ASYNC_THRESHOLD, 50),
  maxCount: parseIntEnv(process.env.EXPORT_MAX_COUNT, 50000),
  /** How long completed export files remain downloadable (supports fractional hours). */
  ttlHours: parseFloatEnv(process.env.EXPORT_FILE_TTL_HOURS, 12),
  /**
   * Local path for export zip files. For Docker + load-balanced replicas, mount the same
   * shared volume (NFS, EFS, CephFS) at this path on every backend container.
   * Future: swap to S3-compatible object storage (MinIO/R2/S3) when local/shared disk
   * is not available — job locking in Postgres already supports multi-instance workers.
   */
  storageDir: process.env.EXPORT_STORAGE_DIR ?? './storage/exports',
  zlibLevel: parseIntEnv(process.env.EXPORT_ZLIB_LEVEL, 6),
  storageGzip: process.env.EXPORT_STORAGE_GZIP !== 'false',
  /** Delay between each snapshot during zip build (ms). Set EXPORT_SIMULATE_PROGRESS_DELAY_MS=0 to disable. */
  simulateProgressDelayMs: parseIntEnv(
    process.env.EXPORT_SIMULATE_PROGRESS_DELAY_MS,
    0,
  ),
  /** Max times a crashed/stale job may be reclaimed before FAILED. */
  maxAttempts: parseIntEnv(process.env.EXPORT_MAX_ATTEMPTS, 3),
  /** No heartbeat for this long → job is stale (ms). */
  staleJobMs: parseIntEnv(process.env.EXPORT_STALE_JOB_MS, 120_000),
  /** How often each instance scans for stale/pending jobs (ms). */
  sweeperIntervalMs: parseIntEnv(process.env.EXPORT_SWEEPER_INTERVAL_MS, 15_000),
};
