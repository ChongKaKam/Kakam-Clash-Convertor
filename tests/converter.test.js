import test from 'node:test';
import assert from 'node:assert/strict';
import YAML from 'yaml';
import { convertSubscription, summarizeSubscription } from '../src/converter.js';

const source = `
proxies:
  - { name: pro-香港-01, type: vless, server: hk.example.com, port: 443, uuid: a }
  - { name: 直连-美国01, type: trojan, server: us.example.com, port: 443, password: b }
  - { name: pro-日本01, type: ss, server: jp.example.com, port: 443, cipher: aes-128-gcm, password: c }
  - { name: lite-台湾01, type: ss, server: tw.example.com, port: 443, cipher: aes-128-gcm, password: d }
proxy-groups:
  - { name: 旧策略, type: select, proxies: [pro-香港-01] }
  - { name: 国内网站, type: select, proxies: [DIRECT] }
rules:
  - DOMAIN,example.com,旧策略
  - DOMAIN-SUFFIX,example.cn,国内网站
  - GEOIP,CN,DIRECT,no-resolve
  - MATCH,旧策略
`;

test('filters nodes and generates four-region auto groups', () => {
  const output = YAML.parse(convertSubscription(source, 'android'));
  assert.deepEqual(output.proxies.map((proxy) => proxy.name), ['pro-香港-01', '直连-美国01', 'pro-日本01']);
  assert.ok(output['proxy-groups'].some((group) => group.name === 'HK 香港自动'));
  assert.ok(!output['proxy-groups'].some((group) => group.name === 'TW 台湾自动'));
  assert.ok(output.rules.includes('DOMAIN,example.com,🐟 漏网之鱼'));
  assert.ok(output.rules.includes('DOMAIN-SUFFIX,example.cn,DIRECT'));
  assert.ok(output.rules.includes('DOMAIN-SUFFIX,apple-relay.fastly-edge.com,🍎 Apple-智能'));
  assert.ok(output.rules.includes('DOMAIN-SUFFIX,cp4.cloudflare.com,🍎 Apple-智能'));
  assert.equal(output.rules.at(-1), 'MATCH,🐟 漏网之鱼');
});

test('applies device-specific tun defaults', () => {
  assert.equal(YAML.parse(convertSubscription(source, 'tvos')).tun.enable, false);
  assert.equal(YAML.parse(convertSubscription(source, 'ios')).tun.enable, false);
  assert.equal(YAML.parse(convertSubscription(source, 'android')).tun.enable, true);
});

test('summarizes selected nodes by region', () => {
  assert.deepEqual(summarizeSubscription(source), {
    proxyCount: 4, selectedCount: 3, ruleCount: 4, regions: { hk: 1, tw: 0, us: 1, jp: 1 },
  });
});
