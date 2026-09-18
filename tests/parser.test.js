import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSubscription } from '../src/parser.js';

test('parses Clash YAML', () => {
  const result = parseSubscription(`proxies:\n  - name: pro-香港-01\n    type: vless\n    server: example.com\n    port: 443\n    uuid: test\nrules:\n  - DOMAIN,example.com,DIRECT\nproxy-groups:\n  - name: old\n    type: select\n    proxies: [DIRECT]\n`);
  assert.equal(result.proxies.length, 1);
  assert.equal(result.rules.length, 1);
  assert.equal(result.groups[0].name, 'old');
});

test('parses base64 vless URI subscription', () => {
  const input = Buffer.from('vless://abc@example.com:443?security=tls#pro-%E7%BE%8E%E5%9B%BD01').toString('base64');
  const result = parseSubscription(input);
  assert.equal(result.proxies[0].name, 'pro-美国01');
  assert.equal(result.proxies[0].uuid, 'abc');
});
