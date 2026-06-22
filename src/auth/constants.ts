export const JWT_ACCESS_SECRET =
  process.env.JWT_ACCESS_SECRET || 'access-secret-change-me';
export const JWT_REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET || 'refresh-secret-change-me';
export const JWT_ACCESS_EXPIRES = '15m';
export const JWT_REFRESH_EXPIRES = '7d';
