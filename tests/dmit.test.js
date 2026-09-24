import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import { readDmitProxies } from '../src/dmit.js';

test('private DMIT file accepts the shared fragment, preserves protocol settings and reloads edits', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'clash-dmit-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'dmit.yaml');
  assert.deepEqual(await readDmitProxies(dir), []);
  const hy2 = { name: 'shared-hy2', type: 'hysteria2', server: '192.0.2.1', port: 7689, password: 'private-fixture', sni: 'example.com', 'skip-cert-verify': true, fingerprint: 'fixture-fingerprint', alpn: ['h3'], udp: true };
  const vless = { name: 'shared-vless', type: 'vless', server: '192.0.2.1', port: 56560, uuid: 'private-fixture', network: 'tcp', tls: true, flow: 'xtls-rprx-vision', 'client-fingerprint': 'chrome', 'reality-opts': { 'public-key': 'fixture-key', 'short-id': '1234' } };
  await fs.writeFile(file, YAML.stringify([hy2, vless]));
  assert.deepEqual(await readDmitProxies(dir), [{ ...vless, name: 'DMIT-US' }, { ...hy2, name: 'DMIT-US-Hysteria2' }]);
  await fs.writeFile(file, YAML.stringify({ proxies: [{ ...vless, port: 8443 }] }));
  assert.deepEqual(await readDmitProxies(dir), [{ ...vless, port: 8443, name: 'DMIT-US' }]);
  for (const invalid of [
    'password: [private-fixture', 'proxies: []', YAML.stringify([vless, vless]),
    YAML.stringify([{ ...vless, tls: false }]), YAML.stringify([{ ...hy2, port: 0 }]),
  ]) {
    await fs.writeFile(file, invalid);
    await assert.rejects(readDmitProxies(dir), error => error.status === 500 && !error.message.includes('private-fixture'));
  }
});
