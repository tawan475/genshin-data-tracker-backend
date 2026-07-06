import 'dotenv/config';

function parseIntEnv(value: string | undefined, fallback: number): number {
  if (value == null || value === '') return fallback;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function parseBoolEnv(value: string | undefined, fallback: boolean): boolean {
  if (value == null || value === '') return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
    return true;
  }
  if (normalized === 'false' || normalized === '0' || normalized === 'no') {
    return false;
  }
  return fallback;
}

export const prismaConfig = {
  slowQueryLog: parseBoolEnv(process.env.PRISMA_SLOW_QUERY_LOG, false),
  slowQueryMs: parseIntEnv(process.env.PRISMA_SLOW_QUERY_MS, 100),
};
