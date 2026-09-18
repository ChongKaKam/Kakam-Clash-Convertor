import path from 'node:path';

function integer(name, fallback, min, max) {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

export const config = Object.freeze({
  port: integer('PORT', 8080, 1, 65535),
  dataDir: path.resolve(process.env.DATA_DIR || './data'),
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, ''),
  adminToken: process.env.ADMIN_TOKEN || '',
  refreshIntervalMinutes: integer('REFRESH_INTERVAL_MINUTES', 360, 5, 10080),
  fetchTimeoutMs: integer('FETCH_TIMEOUT_MS', 15000, 1000, 60000),
  maxSubscriptionBytes: integer('MAX_SUBSCRIPTION_BYTES', 10 * 1024 * 1024, 1024, 50 * 1024 * 1024),
  allowPrivateUpstreams: process.env.ALLOW_PRIVATE_UPSTREAMS === 'true',
  mihomoBin: process.env.MIHOMO_BIN || '',
  latencyTimeoutMs: integer('LATENCY_TIMEOUT_MS', 5000, 1000, 15000),
});
