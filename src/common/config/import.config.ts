function parseIntEnv(value: string | undefined, fallback: number): number {
  if (value == null || value === '') return fallback;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

const maxFileSizeMb = parseIntEnv(process.env.IMPORT_MAX_FILE_SIZE_MB, 50);

export const importConfig = {
  maxFiles: parseIntEnv(process.env.IMPORT_MAX_FILES, 250),
  maxFileSizeBytes: maxFileSizeMb * 1024 * 1024,
  concurrencyLimit: parseIntEnv(process.env.IMPORT_CONCURRENCY_LIMIT, 10),
};
