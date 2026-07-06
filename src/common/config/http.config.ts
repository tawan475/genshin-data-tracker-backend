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

export const httpConfig = {
  slowRequestLog: parseBoolEnv(process.env.HTTP_SLOW_REQUEST_LOG, false),
  slowRequestMs: parseIntEnv(process.env.HTTP_SLOW_REQUEST_MS, 500),
};
