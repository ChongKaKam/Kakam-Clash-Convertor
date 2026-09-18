import test from 'node:test';
import assert from 'node:assert/strict';
import { LatencyManager } from '../src/latency.js';
import { setTimeout as pause } from 'node:timers/promises';

test('latency job limits concurrency, reports partial failures and rejects stale results', async () => {
  let running = 0, peak = 0, closed = false;
  const measured = [];
  const manager = new LatencyManager({ concurrency: 2, probeFactory: () => ({
    async start() {},
    async measure(name) {
      measured.push(name); running++; peak = Math.max(peak, running); await pause(5); running--;
      return name === 'bad' ? { status: 'failed', delayMs: null, error: '测试超时' } : { status: 'ok', delayMs: 123 };
    },
    async close() { closed = true; },
  }) });
  const proxies = ['one', 'two', 'bad', 'four'].map((name) => ({ name, type: 'ss', password: 'secret-node-value' }));
  const started = manager.start('sub', 'ios', proxies);
  assert.equal(started.status, 'running');
  assert.equal(manager.start('sub', 'ios', proxies).startedAt, started.startedAt);
  assert.throws(() => manager.start('other', 'ios', proxies), (e) => e.status === 409);
  await manager.active.promise;
  const result = manager.get('sub', 'ios', proxies);
  assert.equal(peak, 2); assert.equal(closed, true); assert.equal(measured.length, 4);
  assert.equal(result.status, 'complete'); assert.equal(result.completed, 4);
  assert.equal(result.results.filter((r) => r.status === 'ok').length, 3);
  assert.equal(result.results.find((r) => r.name === 'bad').delayMs, null);
  assert.ok(result.results.every((r) => r.checkedAt));
  assert.ok(!JSON.stringify(result).includes('secret-node-value'));
  assert.equal(result.stale, false);
  assert.equal(manager.get('sub', 'ios', [...proxies, { name: 'new' }]).stale, true);
  assert.equal(manager.get('sub', 'tvos', proxies).status, 'idle');
  assert.throws(() => manager.start('sub', 'ios', proxies), (e) => e.status === 429);
});

test('startup failure is visible and cleans resources without fabricated measurements', async () => {
  let closed = false;
  const manager = new LatencyManager({ probeFactory: () => ({
    async start() { throw new Error('内核无法启动'); }, async close() { closed = true; },
  }) });
  const proxies = [{ name: 'test' }];
  manager.start('sub', 'ios', proxies);
  await manager.active.promise;
  const result = manager.get('sub', 'ios', proxies);
  assert.equal(result.status, 'error'); assert.equal(result.error, '内核无法启动');
  assert.equal(result.completed, 0); assert.equal(result.results[0].delayMs, null);
  assert.equal(result.results[0].status, 'unmeasured'); assert.ok(closed);
  assert.equal(manager.active, null);
});

test('missing core is explicit and deletion cancels remaining work', async () => {
  assert.throws(() => new LatencyManager().start('sub', 'ios', [{ name: 'one' }]), (e) => e.status === 503);
  let measured = 0, closed = false;
  const manager = new LatencyManager({ concurrency: 1, probeFactory: () => ({
    async start() {},
    async measure() { measured++; await pause(10); return { status: 'ok', delayMs: 2 }; },
    async close() { closed = true; },
  }) });
  const proxies = [{ name: 'one' }, { name: 'two' }];
  manager.start('sub', 'ios', proxies);
  const done = manager.active.promise;
  manager.remove('sub');
  await done;
  assert.ok(measured < 2); assert.ok(closed);
  assert.equal(manager.get('sub', 'ios', proxies).status, 'idle');
});
