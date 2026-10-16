import test from 'node:test';
import assert from 'node:assert/strict';
import YAML from 'yaml';
import { convertSubscription, summarizeSubscription, buildSubscription, subscriptionPreview } from '../src/converter.js';

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
  assert.ok(output.rules.includes('DOMAIN-SUFFIX,apple-relay.fastly-edge.com,🤖 AI 平台'));
  assert.ok(output.rules.includes('DOMAIN-SUFFIX,cp4.cloudflare.com,🤖 AI 平台'));
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

test('direct-US auto preserves filtering and device-specific AI remains the default', () => {
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
    const ai = groups.find(g => g.name === 'AI-自动');
    const direct = groups.find(g => g.name === '美国-直连-自动');
    assert.ok(ai);
    assert.equal(ai.type, device === 'android' ? 'select' : 'fallback');
    assert.deepEqual(ai.proxies, [direct.name]);
    assert.equal(direct.type, 'url-test');
    assert.deepEqual(direct.proxies, device === 'tvos' ? ['直连-美国02'] : ['直连-美国01', '直连-美国02']);
    const group = groups.find(g => g.name === '🤖 AI 平台');
    assert.ok(group.proxies.includes(ai.name));
    assert.equal(group.proxies.includes(direct.name), device === 'android');
    assert.ok(!groups.some(g => g.name === '🍎 Apple-智能'));
    const aiPlatform = groups.find(g => g.name === '🤖 AI 平台');
    assert.equal(aiPlatform.proxies[0], ai.name);
    assert.equal(aiPlatform['default-selected'], ai.name);
    const global = groups.find(g => g.name === 'GLOBAL');
    assert.equal(global.proxies[0], ai.name);
    assert.equal(global['default-selected'], ai.name);
    assert.ok(!groups.find(g => g.name === '🔎 Google').proxies.includes(ai.name));
    assert.deepEqual(subscriptionPreview(config, device).groups.find(g => g.name === ai.name).members, ai.proxies);
  }
});

test('AI auto is omitted without eligible nodes and never falls back to DIRECT or pro-US', () => {
  const input = YAML.stringify({ proxies: [
    { name: '直连-美国01', type: 'mieru' }, { name: 'pro-美国01', type: 'trojan' },
  ] });
  const groups = buildSubscription(input, 'tvos')['proxy-groups'];
  assert.ok(!groups.some(g => ['AI-自动', '美国-直连-自动', '🌈 AI 自动'].includes(g.name) || g.proxies.includes('AI-自动')));
  const global = groups.find(g => g.name === 'GLOBAL');
  assert.equal(global.proxies[0], '🚀 节点选择');
  assert.equal(global['default-selected'], undefined);
});

test('Spotify offers regional automatic groups and DIRECT without individual nodes', () => {
  const config = buildSubscription(source, 'android');
  const spotify = config['proxy-groups'].find(g => g.name === '🎵 Spotify');
  assert.deepEqual(spotify.proxies, ['HK 香港自动', 'US 美国自动', 'JP 日本自动', 'DIRECT']);
});

const dmitProxies = [
  { name: 'DMIT-US', type: 'vless', server: '192.0.2.1', port: 443, uuid: 'fixture', tls: true, 'reality-opts': { 'public-key': 'fixture' } },
  { name: 'DMIT-US-Hysteria2', type: 'hysteria2', server: '192.0.2.1', port: 8443, password: 'fixture' },
];

test('Esim defaults to DIRECT on every device and no selectable path reaches Hong Kong', () => {
  const hongKongNames = ['pro-香港-01', '直连-HK-02', 'pro-Hong Kong-03', 'pro-🇭🇰-04', 'pro-港-05'];
  const input = YAML.stringify({ proxies: [
    ...hongKongNames.map((name) => ({ name, type: 'trojan', server: 'hk.example.com', port: 443, password: 'fixture' })),
    ...YAML.parse(source).proxies.slice(1),
    { name: 'pro-台湾01', type: 'mieru', server: 'tw.example.com', port: 443, username: 'fixture', password: 'fixture' },
  ] });
  for (const device of ['tvos', 'ios', 'android']) {
    const config = YAML.parse(convertSubscription(input, device, { dmitProxies }));
    const groups = new Map(config['proxy-groups'].map((group) => [group.name, group]));
    const esim = groups.get('Esim');
    assert.equal(esim.type, 'select');
    assert.equal(esim.proxies[0], 'DIRECT');
    assert.equal(esim['default-selected'], 'DIRECT');
    for (const name of ['US 美国自动', 'JP 日本自动', '直连-美国01', 'pro-日本01', 'DMIT-US', 'DMIT-US-Hysteria2']) {
      assert.ok(esim.proxies.includes(name), `${device}: ${name}`);
    }
    assert.equal(esim.proxies.includes('TW 台湾自动'), device !== 'tvos');
    assert.equal(esim.proxies.includes('pro-台湾01'), device !== 'tvos');
    const visit = (name) => {
      assert.ok(!hongKongNames.includes(name), `${device}: Esim reaches ${name}`);
      assert.ok(!['HK 香港自动', '🚀 节点选择', 'GLOBAL'].includes(name), name);
      for (const member of groups.get(name)?.proxies || []) visit(member);
    };
    visit('Esim');
    assert.deepEqual(groups.get('HK 香港自动').proxies, hongKongNames);
    assert.ok(groups.get('🚀 节点选择').proxies.includes('HK 香港自动'));
    assert.ok(groups.get('GLOBAL').proxies.includes('Esim'));
    const preview = subscriptionPreview(config, device).groups.find((group) => group.name === 'Esim');
    assert.equal(preview.default, 'DIRECT');
    assert.deepEqual(preview.members, esim.proxies);
  }
});

test('Esim stays usable with only Hong Kong nodes and excludes mixed-region automatic groups', () => {
  for (const device of ['tvos', 'ios', 'android']) {
    for (const names of [['pro-香港01'], ['pro-US-HK-01', 'pro-美国02']]) {
      const input = YAML.stringify({ proxies: names.map((name) => ({ name, type: 'trojan', server: 'example.com', port: 443, password: 'fixture' })) });
      const config = buildSubscription(input, device);
      const esim = config['proxy-groups'].find((group) => group.name === 'Esim');
      assert.deepEqual(esim.proxies, names.length === 1 ? ['DIRECT'] : ['DIRECT', 'pro-美国02']);
    }
  }
});

test('AI offers only VLESS and direct-US while other select groups include both DMIT protocols', () => {
  for (const device of ['ios', 'android', 'tvos']) {
    const config = YAML.parse(convertSubscription(source, device, { dmitProxies }));
    const groups = config['proxy-groups'];
    assert.deepEqual(config.proxies.slice(0, 2), dmitProxies);
    for (const group of groups.filter(g => g.type === 'select' && g.name !== 'AI-自动')) {
      for (const { name } of dmitProxies) assert.ok(group.proxies.includes(name), `${group.name}: ${name}`);
    }
    const ai = groups.find(g => g.name === 'AI-自动');
    if (device === 'android') {
      assert.deepEqual(ai, { name: 'AI-自动', type: 'select', proxies: ['DMIT-US', '美国-直连-自动'] });
      assert.deepEqual(groups.find(g => g.name === '🤖 AI 平台').proxies.slice(0, 2), ['AI-自动', '美国-直连-自动']);
    } else {
      assert.equal(ai.type, 'fallback');
      assert.equal(ai.url, 'https://www.gstatic.com/generate_204');
      assert.equal(ai.interval, 60);
      assert.equal(ai.lazy, false);
      assert.ok(!groups.find(g => g.name === '🤖 AI 平台').proxies.includes('美国-直连-自动'));
    }
    assert.deepEqual(ai.proxies, ['DMIT-US', '美国-直连-自动']);
    assert.deepEqual(groups.find(g => g.name === '美国-直连-自动').proxies, ['直连-美国01']);
    assert.deepEqual(groups.find(g => g.name === 'HK 香港自动').proxies, ['pro-香港-01']);
    assert.deepEqual(groups.find(g => g.name === 'JP 日本自动').proxies, ['pro-日本01']);
    assert.ok(groups.find(g => g.name === 'US 美国自动').proxies.includes('DMIT-US'));
    for (const name of ['🤖 AI 平台', 'GLOBAL']) {
      assert.equal(groups.find(g => g.name === name).proxies[0], ai.name);
      assert.equal(groups.find(g => g.name === name)['default-selected'], ai.name);
    }
    assert.ok(!groups.some(g => g.name === '🌈 AI 自动'));
    const available = new Set(['DIRECT', 'REJECT', ...config.proxies.map(p => p.name), ...groups.map(g => g.name)]);
    for (const group of groups) for (const name of group.proxies) assert.ok(available.has(name));
    const visit = (name, ancestors = new Set()) => {
      assert.ok(!ancestors.has(name), `cycle: ${name}`);
      const group = groups.find(g => g.name === name);
      if (group) for (const member of group.proxies) visit(member, new Set([...ancestors, name]));
    };
    for (const group of groups) visit(group.name);
    const preview = subscriptionPreview(config, device);
    assert.equal(preview.nodes.find(n => n.name === 'DMIT-US').region, 'us');
    const aiPreview = preview.groups.find(g => g.name === ai.name);
    assert.deepEqual(aiPreview.members, ai.proxies);
    assert.equal(aiPreview.type, device === 'android' ? 'select' : 'fallback');
    assert.equal(aiPreview.default, device === 'android' ? 'DMIT-US' : null);
  }
});

test('DMIT remains usable without eligible upstream nodes or a compatible direct-US fallback', () => {
  const input = YAML.stringify({ proxies: [{ name: '直连-美国01', type: 'mieru' }] });
  const config = buildSubscription(input, 'tvos', { dmitProxies });
  assert.deepEqual(config.proxies, dmitProxies);
  assert.deepEqual(config['proxy-groups'].find(g => g.name === 'AI-自动').proxies, ['DMIT-US']);
  assert.ok(!config['proxy-groups'].some(g => g.name === '美国-直连-自动'));
  const hy2Only = buildSubscription(source, 'ios', { dmitProxies: [dmitProxies[1]] });
  assert.deepEqual(hy2Only['proxy-groups'].find(g => g.name === 'AI-自动').proxies, ['美国-直连-自动']);
});

test('Android AI selection omits unavailable candidates without empty or dangling groups', () => {
  const proOnly = YAML.stringify({ proxies: [{ name: 'pro-美国01', type: 'trojan' }] });
  for (const [input, privateNodes, candidates] of [
    [proOnly, [], []],
    [proOnly, [dmitProxies[1]], []],
    [proOnly, dmitProxies, ['DMIT-US']],
    [source, [dmitProxies[1]], ['美国-直连-自动']],
  ]) {
    const groups = buildSubscription(input, 'android', { dmitProxies: privateNodes })['proxy-groups'];
    const ai = groups.find(g => g.name === 'AI-自动');
    const platform = groups.find(g => g.name === '🤖 AI 平台');
    if (candidates.length) {
      assert.deepEqual(ai, { name: 'AI-自动', type: 'select', proxies: candidates });
      assert.equal(platform.proxies[0], ai.name);
    } else {
      assert.equal(ai, undefined);
      assert.ok(!groups.some(g => g.proxies.includes('AI-自动')));
    }
    assert.equal(platform.proxies.includes('美国-直连-自动'), candidates.includes('美国-直连-自动'));
    assert.ok(groups.every(g => g.proxies.length > 0));
  }
});
