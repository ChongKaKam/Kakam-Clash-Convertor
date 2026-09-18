import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { HttpError } from './errors.js';

export class SubscriptionStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.indexPath = path.join(dataDir, 'subscriptions.json');
    this.items = [];
  }

  async init() {
    await fs.mkdir(this.dataDir, { recursive: true, mode: 0o700 });
    try {
      this.items = JSON.parse(await fs.readFile(this.indexPath, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await this.save();
    }
  }

  publicItem(item) {
    let host = '';
    try { host = new URL(item.url).host; } catch { /* impossible for validated records */ }
    const { url, ...safe } = item;
    return { ...safe, upstreamHost: host };
  }

  list() { return this.items.map((item) => this.publicItem(item)); }
  get(id) { return this.items.find((item) => item.id === id); }
  getByToken(token) { return this.items.find((item) => item.publicToken === token); }

  async create({ name, url, includeUpstreamRules = true }) {
    const now = new Date().toISOString();
    const item = {
      id: crypto.randomUUID(), publicToken: crypto.randomBytes(24).toString('base64url'),
      name, url, includeUpstreamRules, createdAt: now, updatedAt: now,
      lastRefreshAt: null, lastError: null, summary: null,
    };
    this.items.push(item);
    await this.save();
    return item;
  }

  async update(id, changes) {
    const item = this.get(id);
    if (!item) throw new HttpError(404, '订阅不存在');
    Object.assign(item, changes, { updatedAt: new Date().toISOString() });
    await this.save();
    return item;
  }

  async remove(id) {
    const index = this.items.findIndex((item) => item.id === id);
    if (index === -1) throw new HttpError(404, '订阅不存在');
    this.items.splice(index, 1);
    await this.save();
    await fs.rm(this.cachePath(id), { force: true });
  }

  async rotateToken(id) {
    return this.update(id, { publicToken: crypto.randomBytes(24).toString('base64url') });
  }

  cachePath(id) { return path.join(this.dataDir, `${id}.source`); }
  async readCache(id) {
    try { return await fs.readFile(this.cachePath(id), 'utf8'); }
    catch (error) {
      if (error.code === 'ENOENT') throw new HttpError(503, '订阅尚未成功刷新');
      throw error;
    }
  }

  async writeCache(id, text) {
    const target = this.cachePath(id);
    const temp = `${target}.${process.pid}.tmp`;
    await fs.writeFile(temp, text, { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temp, target);
  }

  async save() {
    const temp = `${this.indexPath}.${process.pid}.tmp`;
    await fs.writeFile(temp, `${JSON.stringify(this.items, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temp, this.indexPath);
  }
}
