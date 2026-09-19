import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const root = fileURLToPath(new URL('../', import.meta.url));

test('authenticated whitelist survives restart and immediately changes existing device links', { timeout: 30000 }, async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clash-routing-test-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const source = YAML.stringify({ proxies: [
    { name: 'pro-美国01', type: 'ss', server: 'example.com', port: 443, cipher: 'aes-128-gcm', password: 'fixture' },
    { name: '直连-日本01', type: 'mieru', server: 'example.com', port: 443, username: 'fixture', password: 'fixture' },
  ] });
  const upstream = http.createServer((_req, res) => res.end(source));
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  t.after(() => new Promise((resolve) => upstream.close(resolve)));
  const reservation = http.createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  let child;
  async function stop() {
    if (!child || child.exitCode !== null) return;
    const done = once(child, 'exit');
    child.kill('SIGTERM');
    await done;
  }
  t.after(stop);
  async function start() {
    child = spawn(process.execPath, ['src/server.js'], {
      cwd: root,
      env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, ADMIN_TOKEN: 'integration-secret', PUBLIC_BASE_URL: base, ALLOW_PRIVATE_UPSTREAMS: 'true', MIHOMO_BIN: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await new Promise((resolve, reject) => {
      let logs = '';
      const timer = setTimeout(() => reject(new Error('server startup timeout: ' + logs)), 5000);
      child.stderr.on('data', (chunk) => { logs += chunk; });
      child.once('error', (error) => { clearTimeout(timer); reject(error); });
      child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`server exit ${code}: ${logs}`)); });
      child.stdout.on('data', (chunk) => {
        if (String(chunk).includes('listening')) { clearTimeout(timer); resolve(); }
      });
    });
  }
  const api = (url, method = 'GET', body) => fetch(base + url, {
    method,
    headers: { authorization: 'Bearer integration-secret', 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  await start();
  assert.equal((await fetch(base + '/api/settings')).status, 401);
  const denied = await fetch(base + '/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ directWhitelist: ['evil.example'] }) });
  assert.equal(denied.status, 401);
  assert.deepEqual(await (await api('/api/settings')).json(), { directWhitelist: [] });
  const created = await api('/api/subscriptions', 'POST', { name: 'fixture', url: `http://127.0.0.1:${upstream.address().port}/source.yaml` });
  assert.equal(created.status, 201);
  const subscription = await created.json();
  const previewPath = `/api/subscriptions/${subscription.id}/preview?device=tvos`;
  assert.equal((await fetch(base + previewPath)).status, 401);
  const preview = await (await api(previewPath)).json();
  assert.equal(preview.nodes.length, 1);
  assert.equal(preview.nodes[0].name, 'pro-美国01');
  assert.ok(!JSON.stringify(preview).includes('password'));
  assert.ok(!JSON.stringify(preview).includes('example.com'));
  assert.ok(preview.groups.some((group) => group.name === 'US 美国自动'));
  assert.equal((await api(`/api/subscriptions/${subscription.id}/preview?device=invalid`)).status, 400);
  assert.equal((await api(`/api/subscriptions/${subscription.id}/latency?device=ios`, 'POST')).status, 503);
  const idle = await (await api(`/api/subscriptions/${subscription.id}/latency?device=tvos`)).json();
  assert.equal(idle.status, 'idle'); assert.equal(idle.total, 1);
  const before = await (await fetch(`${base}/sub/${subscription.publicToken}/ios.yaml`)).text();
  assert.ok(before.includes('🤖 AI 平台'));
  const saved = await api('/api/settings', 'PUT', { directWhitelist: 'chatgpt.com\ngateway.icloud.com\n192.0.2.0/24' });
  assert.equal(saved.status, 200);
  const expected = await saved.json();
  for (const device of ['tvos', 'ios', 'android']) {
    // The URL is unchanged and no upstream refresh is needed after a settings edit.
    const response = await fetch(`${base}/sub/${subscription.publicToken}/${device}.yaml`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /yaml/);
    assert.match(response.headers.get('cache-control'), /no-store/);
    const label = { tvos: 'tvOS', ios: 'iOS', android: 'Android' }[device];
    assert.equal(response.headers.get('content-disposition'), `attachment; filename=${label}-kakamlab.yaml`);
    const config = YAML.parse(await response.text());
    assert.ok(Object.values(config['rule-providers']).every((provider) => provider.format === (device === 'ios' ? 'mrs' : 'yaml')));
    if (device === 'ios') assert.ok(!config.rules.some((rule) => /^(GEOIP|GEOSITE|IP-ASN),/.test(rule)));
    const regionGroup = config['proxy-groups'].find((group) => group.name === 'US 美国自动');
    assert.equal(regionGroup.icon, base + '/icons/us.png');
    assert.deepEqual(config.rules.slice(0, 3), ['DOMAIN-SUFFIX,chatgpt.com,DIRECT', 'DOMAIN-SUFFIX,gateway.icloud.com,DIRECT', 'IP-CIDR,192.0.2.0/24,DIRECT']);
    assert.equal(config.proxies.some((p) => p.type === 'mieru'), device !== 'tvos');
  }
  const invalid = await api('/api/settings', 'PUT', { directWhitelist: ['DOMAIN,example.com,REJECT'] });
  assert.equal(invalid.status, 400);
  assert.deepEqual(await (await api('/api/settings')).json(), expected);
  await stop();
  await start();
  assert.deepEqual(await (await api('/api/settings')).json(), expected);
  const after = YAML.parse(await (await fetch(`${base}/sub/${subscription.publicToken}/ios.yaml`)).text());
  assert.equal(after.rules[0], 'DOMAIN-SUFFIX,chatgpt.com,DIRECT');
  await api('/api/settings', 'PUT', { directWhitelist: [] });
  const cleared = YAML.parse(await (await fetch(`${base}/sub/${subscription.publicToken}/ios.yaml`)).text());
  assert.ok(!cleared.rules.includes('DOMAIN-SUFFIX,chatgpt.com,DIRECT'));
  const page = await (await fetch(base)).text();
  assert.ok(page.includes('id="whitelist-form"'));
  for (const code of ['hk', 'tw', 'us', 'jp']) {
    const icon = await fetch(`${base}/icons/${code}.png`);
    assert.equal(icon.status, 200); assert.equal(icon.headers.get('content-type'), 'image/png');
    const bytes = Buffer.from(await icon.arrayBuffer());
    assert.deepEqual([...bytes.subarray(0, 8)], [137,80,78,71,13,10,26,10]);
    assert.equal(bytes.readUInt32BE(16), 96); assert.equal(bytes.readUInt32BE(20), 96);
  }
  assert.equal((await fetch(base + '/explorer.js')).status, 200);
  const urlsScript = await fetch(base + '/urls.js');
  assert.equal(urlsScript.status, 200);
  assert.match(await urlsScript.text(), /overwrite=false/);
});
