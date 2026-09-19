import test from 'node:test';
import assert from 'node:assert/strict';
import YAML from 'yaml';
import {
  AI_AUTO_GROUP, APPLE_INTELLIGENCE_AUTO_GROUP, buildSubscription, convertSubscription,
  subscriptionPreview, summarizeSubscription,
} from '../src/converter.js';

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

test('AI auto stays unchanged while Apple Intelligence gets a dedicated direct-US health group', () => {
  const input = YAML.stringify({ proxies: [
    { name: '直连-美国01', type: 'mieru' },
    { name: '直连-美国02', type: 'trojan' },
    { name: 'pro-美国03', type: 'trojan' },
    { name: '直连-日本01', type: 'trojan' },
    { name: 'pro-直连-美国04', type: 'trojan' },
  ] });
  for (const device of ['ios', 'android', 'tvos']) {
    const config = buildSubscription(input, device);
    const groups = config['proxy-groups'];
    const ai = groups.find(g => g.name === AI_AUTO_GROUP);
    assert.ok(ai);
    assert.equal(ai.type, 'url-test');
    assert.deepEqual(ai.proxies, device === 'tvos' ? ['直连-美国02'] : ['直连-美国01', '直连-美国02']);
    assert.equal(ai.url, 'https://www.gstatic.com/generate_204');
    assert.equal(ai['expected-status'], undefined);

    const appleAuto = groups.find(g => g.name === APPLE_INTELLIGENCE_AUTO_GROUP);
    assert.ok(appleAuto);
    assert.equal(appleAuto.type, 'url-test');
    assert.deepEqual(appleAuto.proxies, ai.proxies);
    assert.equal(appleAuto.url, 'https://ios.chat.openai.com/');
    assert.equal(appleAuto['expected-status'], 403);

    for (const name of ['🤖 AI 平台', '🍎 Apple-智能', '☁️ iCloud', '🍎 苹果服务']) {
      const group = groups.find(g => g.name === name);
      assert.ok(group.proxies.includes(ai.name));
    }
    assert.equal(groups.find(g => g.name === '🤖 AI 平台').proxies[0], AI_AUTO_GROUP);
    assert.equal(groups.find(g => g.name === '🍎 Apple-智能').proxies[0], APPLE_INTELLIGENCE_AUTO_GROUP);
    assert.ok(groups.find(g => g.name === '🤖 AI 平台').proxies.includes(APPLE_INTELLIGENCE_AUTO_GROUP));
    assert.ok(groups.find(g => g.name === '🍎 Apple-智能').proxies.includes(AI_AUTO_GROUP));
    assert.equal(groups.find(g => g.name === '☁️ iCloud').proxies[0], 'DIRECT');
    assert.equal(groups.find(g => g.name === '🍎 苹果服务').proxies[0], 'DIRECT');
    assert.ok(!groups.find(g => g.name === '🔎 Google').proxies.includes(ai.name));
    assert.deepEqual(subscriptionPreview(config, device).groups.find(g => g.name === ai.name).members, ai.proxies);
    assert.deepEqual(subscriptionPreview(config, device).groups.find(g => g.name === appleAuto.name).members, appleAuto.proxies);
  }
});

test('AI auto is omitted without eligible nodes and never falls back to DIRECT or pro-US', () => {
  const input = YAML.stringify({ proxies: [
    { name: '直连-美国01', type: 'mieru' }, { name: 'pro-美国01', type: 'trojan' },
  ] });
  const groups = buildSubscription(input, 'tvos')['proxy-groups'];
  assert.ok(!groups.some(g => [AI_AUTO_GROUP, APPLE_INTELLIGENCE_AUTO_GROUP].includes(g.name)));
  assert.ok(!groups.some(g => g.proxies.some(name => [AI_AUTO_GROUP, APPLE_INTELLIGENCE_AUTO_GROUP].includes(name))));
});

test('mobile Mieru nodes enable UDP when the upstream omits the capability flag', () => {
  const input = YAML.stringify({ proxies: [
    { name: '直连-美国01', type: 'mieru', transport: 'TCP' },
    { name: '直连-美国02', type: 'mieru', transport: 'TCP', udp: false },
    { name: 'pro-美国03', type: 'trojan' },
  ] });
  for (const device of ['ios', 'android']) {
    const proxies = buildSubscription(input, device).proxies;
    assert.equal(proxies.find(p => p.name === '直连-美国01').udp, true);
    assert.equal(proxies.find(p => p.name === '直连-美国02').udp, false);
  }
  assert.ok(!buildSubscription(input, 'tvos').proxies.some(p => p.type === 'mieru'));
});
