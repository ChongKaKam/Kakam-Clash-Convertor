import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { parseEnv } from 'node:util';
import YAML from 'yaml';

test('local and production startup use separate environment files and data stores', async () => {
  const pkg = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.match(pkg.scripts.dev, /--env-file=\.env\.local --watch/);
  assert.match(pkg.scripts['start:local'], /--env-file=\.env\.local/);
  const local = parseEnv(await fs.readFile(new URL('../.env.local.example', import.meta.url), 'utf8'));
  const production = parseEnv(await fs.readFile(new URL('../.env.production.example', import.meta.url), 'utf8'));
  assert.equal(local.DATA_DIR, './data');
  assert.equal(local.PUBLIC_BASE_URL, '');
  assert.equal(local.NODE_ENV, 'development');
  assert.equal(production.ALLOW_PRIVATE_UPSTREAMS, 'false');
  assert.equal(production.ADMIN_TOKEN, ''); // Fail closed until operator configures it.
  assert.equal(production.MIHOMO_BIN, undefined);
  const compose = YAML.parse(await fs.readFile(new URL('../compose.yaml', import.meta.url), 'utf8'));
  const service = compose.services['clash-converter'];
  assert.deepEqual(service.volumes, ['clash-converter-data:/data']);
  assert.match(service.ports[0], /^127\.0\.0\.1:/);
  assert.match(service.environment.ADMIN_TOKEN, /:\?/);
  assert.match(service.environment.PUBLIC_BASE_URL, /:\?/);
  const env = { ...process.env };
  for (const key of Object.keys(local)) delete env[key];
  const run = spawnSync(process.execPath, ['--env-file=.env.local.example', '--input-type=module', '-e',
    'import {config} from "./src/config.js"; console.log(JSON.stringify({mode:process.env.NODE_ENV,base:config.publicBaseUrl,private:config.allowPrivateUpstreams}))'],
  { cwd: new URL('../', import.meta.url), env, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout), { mode: 'development', base: '', private: false });
});
