// Optional native-core integration check. Never uploads the subscription or probes
// its nodes. Public rule lists are downloaded; local temporary secrets are removed.
// This measures macOS/Linux startup, NOT the iOS Network Extension memory limit.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import YAML from 'yaml';
import { buildSubscription } from '../src/converter.js';
import { ruleProviders, routingRules } from '../src/routing.js';
import { parseSubscription } from '../src/parser.js';

const { CORE_BIN, SOURCE_FILE } = process.env;
if (!CORE_BIN || !SOURCE_FILE) throw new Error('Set CORE_BIN and SOURCE_FILE');
console.log(execFileSync(CORE_BIN, ['-v'], { encoding: 'utf8' }).trim());
const text = await fs.readFile(SOURCE_FILE, 'utf8');
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'clash-ios-core-'));

async function verify(label, config) {
  const dir = path.join(root, label);
  await fs.mkdir(dir, { mode: 0o700 });
  let bytes = 0;
  for (const [name, provider] of Object.entries(config['rule-providers'])) {
    const response = await fetch(provider.url, { signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error(`${label}: public provider ${name}: HTTP ${response.status}`);
    const data = Buffer.from(await response.arrayBuffer());
    bytes += data.length;
    const file = path.join(dir, `${name}.${provider.format}`);
    await fs.writeFile(file, data, { mode: 0o600 });
    config['rule-providers'][name] = { type: 'file', behavior: provider.behavior, format: provider.format, path: file };
  }
  const reservation = net.createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const secret = randomBytes(24).toString('hex');
  // Identical overrides in both cases isolate rule-loading cost and avoid touching
  // the host's VPN, DNS or proxy, or connecting to private subscription nodes.
  Object.assign(config, {
    'mixed-port': 0, 'allow-lan': false, 'bind-address': '127.0.0.1',
    'external-controller': `127.0.0.1:${port}`, secret,
    tun: { enable: false }, dns: { enable: false }, sniffer: { enable: false },
    'log-level': 'silent',
  });
  config['proxy-groups'] = config['proxy-groups'].map(({ name, proxies }) => ({ name, type: 'select', proxies }));
  const file = path.join(dir, 'config.yaml');
  await fs.writeFile(file, YAML.stringify(config), { mode: 0o600 });
  const child = spawn(CORE_BIN, ['-d', dir, '-f', file], { stdio: 'ignore' });
  const exited = once(child, 'exit');
  let peakRssKiB = 0;
  let finalRssKiB = 0;
  let readyAt;
  let loaded;
  const api = async (route) => {
    const response = await fetch(`http://127.0.0.1:${port}${route}`, {
      headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(1000),
    });
    if (!response.ok) throw new Error('Core API not ready');
    return response.json();
  };
  try {
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(`${label}: core exited during startup`);
      try {
        finalRssKiB = Number(execFileSync('ps', ['-o', 'rss=', '-p', String(child.pid)], { encoding: 'utf8' }).trim());
        peakRssKiB = Math.max(peakRssKiB, finalRssKiB);
        const result = await api('/providers/rules');
        loaded = Object.values(result.providers);
        if (loaded.length === Object.keys(config['rule-providers']).length && loaded.every((p) => p.ruleCount > 0)) {
          readyAt ??= Date.now();
          if (Date.now() - readyAt > 2000) {
            console.log(JSON.stringify({ label, providers: loaded.length, rules: loaded.reduce((n, p) => n + p.ruleCount, 0), downloadBytes: bytes, peakRssKiB, settledRssKiB: finalRssKiB }));
            return;
          }
        }
      } catch { /* Startup/API may not yet be ready. Deadline remains bounded. */ }
      await delay(50);
    }
    throw new Error(`${label}: not all rule providers loaded before timeout`);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await exited;
  }
}

try {
  const legacy = buildSubscription(text, 'ios');
  legacy['rule-providers'] = ruleProviders('android');
  legacy.rules = routingRules(parseSubscription(text), { device: 'android', directRules: [] });
  await verify('legacy-yaml', legacy);
  await verify('ios-mrs', buildSubscription(text, 'ios'));
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
