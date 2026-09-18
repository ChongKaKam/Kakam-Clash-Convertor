import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';
import YAML from 'yaml';
import { HttpError } from './errors.js';

export const TEST_URL = 'https://www.gstatic.com/generate_204';
const fingerprint = (proxies) => createHash('sha256').update(JSON.stringify(proxies)).digest('hex');

async function reservePort() {
  const socket = net.createServer();
  await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', resolve); });
  const port = socket.address().port;
  await new Promise((resolve, reject) => socket.close((error) => error ? reject(error) : resolve()));
  return port;
}

export class MihomoProbe {
  constructor(binary, timeoutMs = 5000) {
    this.binary = binary;
    this.timeoutMs = timeoutMs;
    this.secret = randomBytes(24).toString('hex');
    this.child = null;
    this.directory = null;
  }

  async start(proxies) {
    if (!this.binary) throw new Error('测速内核未配置，请设置 MIHOMO_BIN');
    this.directory = await fs.mkdtemp(path.join(os.tmpdir(), 'clash-latency-'));
    const port = await reservePort();
    this.base = `http://127.0.0.1:${port}`;
    const configPath = path.join(this.directory, 'config.yaml');
    // This instance only exposes a loopback controller with a per-run secret.
    // It has no proxy listener, TUN, DNS listener, system proxy or remote provider.
    await fs.writeFile(configPath, YAML.stringify({
      port: 0, 'socks-port': 0, 'mixed-port': 0, 'allow-lan': false,
      'external-controller': `127.0.0.1:${port}`, secret: this.secret,
      mode: 'rule', 'log-level': 'silent', ipv6: false,
      dns: { enable: false }, tun: { enable: false },
      profile: { 'store-selected': false }, proxies, rules: ['MATCH,DIRECT'],
    }), { mode: 0o600 });
    this.child = spawn(this.binary, ['-d', this.directory, '-f', configPath], { stdio: 'ignore' });
    let startError = false;
    this.child.once('error', () => { startError = true; });
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (startError || this.child.exitCode !== null || this.child.signalCode !== null) {
        throw new Error('测速内核无法启动，请检查 MIHOMO_BIN 路径、执行权限及节点协议支持');
      }
      try {
        const response = await fetch(`${this.base}/version`, { headers: this.headers(), signal: AbortSignal.timeout(500) });
        if (response.ok) { await response.json(); return; }
        await response.body?.cancel();
      } catch { /* controller is not ready yet */ }
      await pause(100);
    }
    throw new Error('测速内核启动超时');
  }

  headers() { return { authorization: `Bearer ${this.secret}` }; }

  async measure(name) {
    const query = new URLSearchParams({ url: TEST_URL, timeout: String(this.timeoutMs), expected: '204' });
    try {
      const response = await fetch(`${this.base}/proxies/${encodeURIComponent(name)}/delay?${query}`, {
        headers: this.headers(), signal: AbortSignal.timeout(this.timeoutMs + 1500),
      });
      const data = await response.json();
      if (response.ok && Number.isFinite(data.delay) && data.delay > 0) return { status: 'ok', delayMs: data.delay };
      return { status: 'failed', delayMs: null, error: response.status === 504 ? '测试超时' : '代理连接或测试请求失败' };
    } catch {
      return { status: 'failed', delayMs: null, error: '测试超时或内核连接中断' };
    }
  }

  async close() {
    if (this.child?.pid && this.child.exitCode === null && this.child.signalCode === null) {
      await new Promise((resolve) => {
        const timer = setTimeout(() => this.child.kill('SIGKILL'), 1500);
        this.child.once('exit', () => { clearTimeout(timer); resolve(); });
        this.child.kill('SIGTERM');
      });
    }
    if (this.directory) { await fs.rm(this.directory, { recursive: true, force: true }); this.directory = null; }
  }
}

export class LatencyManager {
  constructor({ binary = '', concurrency = 4, timeoutMs = 5000, probeFactory } = {}) {
    this.available = Boolean(binary || probeFactory);
    this.factory = probeFactory || (() => new MihomoProbe(binary, timeoutMs));
    this.concurrency = concurrency;
    this.jobs = new Map();
    this.active = null;
  }

  get(id, device, proxies) {
    const job = this.jobs.get(`${id}:${device}`);
    if (!job) return { available: this.available, status: 'idle', target: TEST_URL, results: [], completed: 0, total: proxies.length, stale: false };
    const { signature, cancel, ...publicJob } = job;
    return structuredClone({ ...publicJob, available: this.available, stale: signature !== fingerprint(proxies) });
  }

  start(id, device, proxies) {
    if (!this.available) throw new HttpError(503, '服务器未配置测速内核 MIHOMO_BIN');
    const key = `${id}:${device}`;
    if (this.active) {
      if (this.active.key === key) return this.get(id, device, proxies);
      throw new HttpError(409, '另一组节点正在测速，请等待完成');
    }
    if (!proxies.length || proxies.length > 500) throw new HttpError(422, '每次测速需有 1–500 个过滤后节点');
    const previous = this.jobs.get(key);
    if (previous?.finishedAt && Date.now() - Date.parse(previous.finishedAt) < 10000) throw new HttpError(429, '请等待 10 秒再重新测速');
    // Bound in-memory history; snapshots never contain node credentials or server addresses.
    if (this.jobs.size >= 100 && !this.jobs.has(key)) this.jobs.delete(this.jobs.keys().next().value);
    const job = {
      status: 'running', target: TEST_URL, startedAt: new Date().toISOString(), finishedAt: null,
      total: proxies.length, completed: 0, error: null, signature: fingerprint(proxies), cancel: false,
      results: proxies.map(({ name }) => ({ name, status: 'pending', delayMs: null, checkedAt: null })),
    };
    this.jobs.set(key, job);
    const active = { key, job, promise: null };
    this.active = active;
    active.promise = this.run(job, proxies).finally(() => { if (this.active === active) this.active = null; });
    return this.get(id, device, proxies);
  }

  async run(job, proxies) {
    const probe = this.factory();
    try {
      await probe.start(proxies);
      let index = 0;
      await Promise.all(Array.from({ length: Math.min(this.concurrency, proxies.length) }, async () => {
        while (!job.cancel && index < proxies.length) {
          const current = index++;
          job.results[current].status = 'testing';
          const measurement = await probe.measure(proxies[current].name);
          Object.assign(job.results[current], measurement, { checkedAt: new Date().toISOString() });
          job.completed += 1;
        }
      }));
      job.status = job.cancel ? 'cancelled' : 'complete';
    } catch (error) {
      job.status = 'error'; job.error = error.message;
      for (const result of job.results) if (['pending', 'testing'].includes(result.status)) result.status = 'unmeasured';
    } finally {
      try { await probe.close(); } catch { job.error ||= '测速临时资源清理失败'; }
      job.finishedAt = new Date().toISOString();
    }
  }

  remove(id) {
    for (const [key, job] of this.jobs) if (key.startsWith(`${id}:`)) { job.cancel = true; this.jobs.delete(key); }
  }

  async close() {
    if (this.active) { this.active.job.cancel = true; await this.active.promise; }
  }
}
