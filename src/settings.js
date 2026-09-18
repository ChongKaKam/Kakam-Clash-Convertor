import fs from 'node:fs/promises';
import path from 'node:path';
import { isIP } from 'node:net';
import { domainToASCII } from 'node:url';
import { randomUUID } from 'node:crypto';
import { HttpError } from './errors.js';

// Stored as predicates without a policy; the policy can only ever be DIRECT.
export function normalizeDirectWhitelist(input) {
  const entries = typeof input === 'string' ? input.split(/\r?\n/) : input;
  if (!Array.isArray(entries) || entries.length > 500) throw new HttpError(400, '白名单最多 500 条');
  const result = [];
  for (const [index, entry] of entries.entries()) {
    const invalid = () => new HttpError(400, `白名单第 ${index + 1} 行无效：支持域名、IP/CIDR 或 DOMAIN、DOMAIN-SUFFIX、IP-CIDR、IP-CIDR6 条目`);
    if (typeof entry !== 'string' || entry.length > 512) throw invalid();
    if (!entry.trim()) continue;
    const parts = entry.trim().split(',').map((v) => v.trim());
    let type, value;
    if (parts.length === 1) {
      value = parts[0];
      const family = isIP(value.split('/')[0]);
      type = family === 4 ? 'IP-CIDR' : family === 6 ? 'IP-CIDR6' : 'DOMAIN-SUFFIX';
    } else if (parts.length === 2 || (parts.length === 3 && parts[2].toUpperCase() === 'DIRECT')) {
      [type, value] = parts;
      type = type.toUpperCase();
    } else throw invalid();
    if (['IP-CIDR', 'IP-CIDR6'].includes(type)) {
      const family = type === 'IP-CIDR' ? 4 : 6;
      const [address, prefix, extra] = value.split('/');
      const max = family === 4 ? 32 : 128;
      if (extra !== undefined || isIP(address) !== family || (prefix !== undefined && (!/^\d+$/.test(prefix) || Number(prefix) > max))) throw invalid();
      value = `${address.toLowerCase()}/${prefix === undefined ? max : Number(prefix)}`;
    } else if (['DOMAIN', 'DOMAIN-SUFFIX'].includes(type)) {
      if (/[\s/:?#@%\\\[\]]/u.test(value)) throw invalid();
      value = domainToASCII(value.toLowerCase().replace(/\.$/, ''));
      if (!value || value.length > 253 || isIP(value) || !value.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) throw invalid();
    } else throw invalid();
    result.push(`${type},${value}`);
  }
  return [...new Set(result)];
}

export function directWhitelistRules(input = []) {
  // No no-resolve: an IP whitelist must also work when the client knows a hostname.
  return normalizeDirectWhitelist(input).map((predicate) => `${predicate},DIRECT`);
}

export class SettingsStore {
  constructor(dataDir) {
    this.file = path.join(dataDir, 'settings.json');
    this.value = { directWhitelist: [] };
    this.pending = Promise.resolve();
  }
  async init() {
    try {
      const data = JSON.parse(await fs.readFile(this.file, 'utf8'));
      this.value = { directWhitelist: normalizeDirectWhitelist(data.directWhitelist ?? []) };
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  get() { return structuredClone(this.value); }
  update(input) {
    const next = { directWhitelist: normalizeDirectWhitelist(input) };
    const operation = this.pending.then(async () => {
      const temp = `${this.file}.${randomUUID()}.tmp`;
      await fs.writeFile(temp, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
      await fs.rename(temp, this.file);
      this.value = next;
      return this.get();
    });
    this.pending = operation.catch(() => {});
    return operation;
  }
}
