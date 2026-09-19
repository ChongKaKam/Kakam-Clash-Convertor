import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { buildSubscription, convertSubscription, subscriptionPreview, summarizeSubscription } from './converter.js';
import { HttpError } from './errors.js';
import { fetchSubscription } from './fetcher.js';
import { SubscriptionStore } from './store.js';
import { SettingsStore } from './settings.js';
import { REGION_ICONS } from './icons.js';
import { LatencyManager } from './latency.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(root, 'public');
const store = new SubscriptionStore(config.dataDir);
await store.init();
const settings = new SettingsStore(config.dataDir);
await settings.init();
const latency = new LatencyManager({ binary: config.mihomoBin, timeoutMs: config.latencyTimeoutMs });

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store' });
  res.end(body);
}

function checkAuth(req) {
  if (!config.adminToken) return;
  const header = req.headers.authorization || '';
  const candidate = header.startsWith('Bearer ') ? header.slice(7) : '';
  const expected = Buffer.from(config.adminToken);
  const actual = Buffer.from(candidate);
  if (actual.length !== expected.length || !cryptoSafeEqual(actual, expected)) throw new HttpError(401, '管理令牌无效');
}

function cryptoSafeEqual(a, b) {
  let value = 0;
  for (let i = 0; i < a.length; i += 1) value |= a[i] ^ b[i];
  return value === 0;
}

async function bodyJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64 * 1024) throw new HttpError(413, '请求内容过大');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw new HttpError(400, '请求 JSON 格式错误'); }
}

function validateInput(input, partial = false) {
  const result = {};
  if (!partial || input.name !== undefined) {
    if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 100) throw new HttpError(400, '名称需为 1–100 个字符');
    result.name = input.name.trim();
  }
  if (!partial || input.url !== undefined) {
    if (typeof input.url !== 'string' || input.url.length > 4096) throw new HttpError(400, '订阅地址无效');
    try {
      const parsed = new URL(input.url);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
    } catch { throw new HttpError(400, '订阅地址需为 HTTP/HTTPS URL'); }
    result.url = input.url;
  }
  if (input.includeUpstreamRules !== undefined) result.includeUpstreamRules = Boolean(input.includeUpstreamRules);
  return result;
}

async function refresh(item) {
  try {
    const text = await fetchSubscription(item.url, {
      allowPrivate: config.allowPrivateUpstreams,
      timeoutMs: config.fetchTimeoutMs,
      maxBytes: config.maxSubscriptionBytes,
    });
    const summary = summarizeSubscription(text);
    if (!summary.selectedCount) throw new HttpError(422, '上游没有符合筛选条件的节点');
    await store.writeCache(item.id, text);
    await store.update(item.id, { summary, lastRefreshAt: new Date().toISOString(), lastError: null });
    return store.get(item.id);
  } catch (error) {
    await store.update(item.id, { lastError: error.message });
    throw error;
  }
}

function baseUrl(req) {
  return config.publicBaseUrl || `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;
}

async function api(req, res, url) {
  checkAuth(req);
  if (url.pathname === '/api/settings') {
    if (req.method === 'GET') return json(res, 200, settings.get());
    if (req.method === 'PUT') {
      const input = await bodyJson(req);
      if (!input || !Object.hasOwn(input, 'directWhitelist')) throw new HttpError(400, '缺少 directWhitelist');
      return json(res, 200, await settings.update(input.directWhitelist));
    }
    throw new HttpError(405, '不支持此操作');
  }
  if (req.method === 'GET' && url.pathname === '/api/subscriptions') {
    return json(res, 200, { items: store.list(), publicBaseUrl: baseUrl(req), authEnabled: Boolean(config.adminToken) });
  }
  if (req.method === 'POST' && url.pathname === '/api/subscriptions') {
    const input = validateInput(await bodyJson(req));
    const item = await store.create(input);
    try {
      await refresh(item);
      return json(res, 201, store.publicItem(store.get(item.id)));
    } catch (error) {
      await store.remove(item.id);
      throw error;
    }
  }
  const match = url.pathname.match(/^\/api\/subscriptions\/([0-9a-f-]+)(?:\/(refresh|token|preview|latency))?$/);
  if (!match) throw new HttpError(404, '接口不存在');
  const [, id, action] = match;
  const item = store.get(id);
  if (!item) throw new HttpError(404, '订阅不存在');
  if (action === 'preview' || action === 'latency') {
    const device = url.searchParams.get('device') || 'ios';
    const built = buildSubscription(await store.readCache(id), device, {
      includeUpstreamRules: item.includeUpstreamRules, directWhitelist: settings.get().directWhitelist,
    });
    if (req.method === 'GET' && action === 'preview') return json(res, 200, {
      ...subscriptionPreview(built, device), latency: latency.get(id, device, built.proxies),
    });
    if (action === 'latency') {
      if (req.method === 'GET') return json(res, 200, latency.get(id, device, built.proxies));
      if (req.method === 'POST') return json(res, 202, latency.start(id, device, built.proxies));
    }
    throw new HttpError(405, '不支持此操作');
  }
  if (req.method === 'POST' && action === 'refresh') return json(res, 200, store.publicItem(await refresh(item)));
  if (req.method === 'POST' && action === 'token') return json(res, 200, store.publicItem(await store.rotateToken(id)));
  if (req.method === 'PATCH' && !action) {
    const changes = validateInput(await bodyJson(req), true);
    const urlChanged = changes.url && changes.url !== item.url;
    const updated = await store.update(id, changes);
    if (urlChanged) await refresh(updated);
    return json(res, 200, store.publicItem(store.get(id)));
  }
  if (req.method === 'DELETE' && !action) {
    latency.remove(id);
    await store.remove(id);
    res.writeHead(204).end();
    return;
  }
  throw new HttpError(405, '不支持此操作');
}

async function serveStatic(res, pathname) {
  const icon = pathname.match(/^\/icons\/(hk|tw|us|jp)\.png$/);
  if (icon) {
    res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' });
    return res.end(REGION_ICONS[icon[1]]);
  }
  const files = {
    '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'],
    '/explorer.js': ['explorer.js', 'text/javascript'], '/urls.js': ['urls.js', 'text/javascript'],
    '/styles.css': ['styles.css', 'text/css'],
  };
  const entry = files[pathname];
  if (!entry) throw new HttpError(404, '页面不存在');
  const body = await fs.readFile(path.join(publicDir, entry[0]));
  res.writeHead(200, { 'content-type': `${entry[1]}; charset=utf-8`, 'content-length': body.length, 'cache-control': 'no-cache' });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/healthz') return json(res, 200, { status: 'ok' });
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    const output = url.pathname.match(/^\/sub\/([A-Za-z0-9_-]+)\/(tvos|ios|android)\.yaml$/);
    if (req.method === 'GET' && output) {
      const item = store.getByToken(output[1]);
      if (!item) throw new HttpError(404, '订阅地址不存在');
      const source = await store.readCache(item.id);
      const body = convertSubscription(source, output[2], {
        includeUpstreamRules: item.includeUpstreamRules,
        directWhitelist: settings.get().directWhitelist,
        publicBaseUrl: baseUrl(req),
      });
      res.writeHead(200, {
        'content-type': 'text/yaml; charset=utf-8',
        'content-disposition': `attachment; filename=${{ tvos: 'tvOS', ios: 'iOS', android: 'Android' }[output[2]]}-kakamlab.yaml`,
        'profile-update-interval': String(config.refreshIntervalMinutes / 60),
        'cache-control': 'private, no-store',
      });
      return res.end(body);
    }
    if (req.method === 'GET') return await serveStatic(res, url.pathname);
    throw new HttpError(405, '不支持此操作');
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    if (status === 500) console.error(error);
    json(res, status, { error: error.message || '服务器内部错误', details: error.details });
  }
});

let refreshing = false;
async function refreshAll() {
  if (refreshing) return;
  refreshing = true;
  try {
    for (const item of [...store.items]) {
      try { await refresh(item); }
      catch (error) { console.warn(`refresh failed for ${item.id}: ${error.message}`); }
    }
  } finally { refreshing = false; }
}

const timer = setInterval(refreshAll, config.refreshIntervalMinutes * 60_000);
timer.unref();
server.listen(config.port, '0.0.0.0', () => {
  console.log(`Clash subscription converter listening on :${config.port}`);
  if (!config.adminToken) console.warn('WARNING: ADMIN_TOKEN is empty; management API is not protected');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    clearInterval(timer);
    server.close();
    await latency.close();
    process.exit(0);
  });
}
