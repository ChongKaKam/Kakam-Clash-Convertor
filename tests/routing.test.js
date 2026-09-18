import test from 'node:test';
import assert from 'node:assert/strict';
import YAML from 'yaml';
import { convertSubscription } from '../src/converter.js';
import { GROUP, APPLE_INTELLIGENCE_DOMAINS } from '../src/routing.js';
import { normalizeDirectWhitelist, directWhitelistRules } from '../src/settings.js';

const source = YAML.stringify({
  proxies: [
    { name: 'pro-美国01', type: 'ss', server: 'us.example.com', port: 443, cipher: 'aes-128-gcm', password: 'test' },
    { name: '直连-日本01', type: 'trojan', server: 'jp.example.com', port: 443, password: 'test' },
    { name: 'pro-台湾01', type: 'mieru', server: 'tw.example.com', port: 443, username: 'test', password: 'test' },
  ],
  'proxy-groups': ['🧲 AI', '🔎 Google', '📪 邮件服务', '🎬 HBOGO', '🎬 日本媒体', '🛡 广告拦截'].map((name) => ({ name, type: 'select', proxies: ['DIRECT'] })),
  rules: [
    'DOMAIN-SUFFIX,mail.custom.example,📪 邮件服务',
    'DOMAIN-SUFFIX,custom.example,🔎 Google',
    'DOMAIN-SUFFIX,inherited-ai.example,🧲 AI',
    'DOMAIN-SUFFIX,inherited-hbo.example,🎬 HBOGO',
    'DOMAIN-SUFFIX,inherited-jp.example,🎬 日本媒体',
    'DOMAIN-SUFFIX,ads.example,🛡 广告拦截',
    'GEOSITE,category-ai-!cn,🧲 AI', 'GEOSITE,category-ai-cn,🧲 AI',
    'RULE-SET,missing-provider,🔎 Google', 'MATCH,DIRECT',
  ],
});
const output = (device = 'ios', options = {}) => YAML.parse(convertSubscription(source, device, options));

// Test actual first-match ordering, including parent/child collisions. Provider
// contents are external; only domain predicates are evaluated by this helper.
function domainRoute(config, host) {
  return config.rules.find((rule) => {
    const [type, value] = rule.split(',');
    return type === 'DOMAIN' ? host === value : type === 'DOMAIN-SUFFIX' ? host === value || host.endsWith(`.${value}`) : false;
  })?.split(',')[2];
}

test('service groups have independent selections including DIRECT and individual direct-named proxies', () => {
  const config = output();
  for (const name of Object.values(GROUP)) {
    const group = config['proxy-groups'].find((item) => item.name === name);
    assert.ok(group, name);
    assert.ok(group.proxies.includes('DIRECT'), name);
    assert.ok(group.proxies.includes('直连-日本01'), name);
    assert.ok(group.proxies.includes('US 美国自动'), name);
  }
  assert.equal(config['proxy-groups'].find((g) => g.name === GROUP.ai).proxies[0], 'US 美国自动');
  assert.equal(config['proxy-groups'].find((g) => g.name === GROUP.japan).proxies[0], 'JP 日本自动');
  assert.equal(config['proxy-groups'].find((g) => g.name === GROUP.ads).proxies[0], 'REJECT');
  assert.equal(config['proxy-groups'].find((g) => g.name === GROUP.domestic).proxies[0], 'DIRECT');
});

test('first-match rules send AI, streaming and mail ahead of broader company domains', () => {
  const config = output();
  for (const host of ['api.openai.com', 'api.anthropic.com', 'claude.ai', 'perplexity.ai', 'gemini.google.com', 'aistudio.google.com', 'grok.com', 'api.x.ai', 'copilot.microsoft.com', 'inherited-ai.example']) {
    assert.equal(domainRoute(config, host), GROUP.ai, host);
  }
  for (const [host, group] of [
    ['youtubei.googleapis.com', GROUP.youtube], ['www.youtube.com', GROUP.youtube],
    ['www.netflix.com', GROUP.netflix], ['www.hbomax.com', GROUP.hbo], ['inherited-hbo.example', GROUP.hbo],
    ['www.google.com', GROUP.google], ['mail.google.com', GROUP.mail], ['smtp.office365.com', GROUP.mail],
    ['mail.custom.example', GROUP.mail], ['mail.icloud.com', GROUP.mail],
    ['abema.tv', GROUP.japan], ['inherited-jp.example', GROUP.japan], ['example.jp', GROUP.japan],
    ['www.icloud.com', GROUP.icloud], ['www.apple.com', GROUP.apple], ['www.microsoft.com', GROUP.microsoft],
    ['www.bilibili.com', GROUP.domestic], ['v.qq.com', GROUP.domestic], ['ads.example', GROUP.ads],
  ]) assert.equal(domainRoute(config, host), group, host);
});

test('all eleven Apple login domains route before generic iCloud, Apple and CDN rules', () => {
  const config = output('ios');
  assert.equal(APPLE_INTELLIGENCE_DOMAINS.length, 11);
  for (const domain of APPLE_INTELLIGENCE_DOMAINS) {
    assert.equal(domainRoute(config, domain), GROUP.intelligence, domain);
    assert.equal(domainRoute(config, `test.${domain}`), GROUP.intelligence, domain);
  }
});

test('global whitelist overrides Apple Intelligence, AI, streaming and advertisements', () => {
  const config = output('ios', { directWhitelist: ['icloud.com', 'chatgpt.com', 'youtube.com', 'ads.example', '192.0.2.0/24'] });
  for (const domain of ['gateway.icloud.com', 'chatgpt.com', 'youtube.com', 'ads.example']) assert.equal(domainRoute(config, domain), 'DIRECT');
  assert.deepEqual(config.rules.slice(0, 5), [
    'DOMAIN-SUFFIX,icloud.com,DIRECT', 'DOMAIN-SUFFIX,chatgpt.com,DIRECT',
    'DOMAIN-SUFFIX,youtube.com,DIRECT', 'DOMAIN-SUFFIX,ads.example,DIRECT', 'IP-CIDR,192.0.2.0/24,DIRECT',
  ]);
});

test('tvOS removes Mieru before groups are built; other devices keep it', () => {
  const tv = output('tvos');
  assert.ok(!tv.proxies.some((p) => p.type.toLowerCase() === 'mieru'));
  assert.ok(!tv['proxy-groups'].some((g) => g.name === 'TW 台湾自动'));
  assert.ok(tv['proxy-groups'].every((g) => !g.proxies.includes('pro-台湾01')));
  for (const device of ['ios', 'android']) assert.ok(output(device).proxies.some((p) => p.type === 'mieru'));
  const onlyMieru = YAML.stringify({ proxies: [{ name: 'pro-美国01', type: 'Mieru' }] });
  assert.throws(() => convertSubscription(onlyMieru, 'tvos'), (e) => e.status === 422 && /Mieru/.test(e.message));
});

test('no unresolved groups or rule providers and no dependency on GeoSite categories', () => {
  for (const device of ['tvos', 'ios', 'android']) {
    const config = output(device);
    const actions = new Set(['DIRECT', 'REJECT', 'REJECT-DROP', ...config.proxies.map((p) => p.name), ...config['proxy-groups'].map((g) => g.name)]);
    for (const group of config['proxy-groups']) {
      assert.ok(group.proxies.length);
      for (const action of group.proxies) assert.ok(actions.has(action), action);
    }
    for (const rule of config.rules) {
      assert.ok(!rule.startsWith('GEOSITE,'));
      const parts = rule.split(',');
      assert.ok(actions.has(parts.at(-1) === 'no-resolve' ? parts.at(-2) : parts.at(-1)), rule);
      if (parts[0] === 'RULE-SET') assert.ok(config['rule-providers'][parts[1]], rule);
    }
    assert.equal(config.rules.at(-1), `MATCH,${GROUP.final}`);
  }
});

test('service categories still exist with upstream merging disabled', () => {
  const config = output('ios', { includeUpstreamRules: false });
  assert.equal(domainRoute(config, 'mail.google.com'), GROUP.mail);
  assert.equal(domainRoute(config, 'inherited-ai.example'), undefined);
  assert.equal(domainRoute(config, 'grok.com'), GROUP.ai);
});

test('whitelist normalization validates predicates and rejects policy injection', () => {
  assert.deepEqual(normalizeDirectWhitelist('EXAMPLE.com\n\nDOMAIN, api.example.com, DIRECT\n192.0.2.1\n2001:db8::/32\nexample.com'), [
    'DOMAIN-SUFFIX,example.com', 'DOMAIN,api.example.com', 'IP-CIDR,192.0.2.1/32', 'IP-CIDR6,2001:db8::/32',
  ]);
  assert.deepEqual(directWhitelistRules(['DOMAIN,example.com']), ['DOMAIN,example.com,DIRECT']);
  for (const bad of ['example.com,REJECT', 'MATCH,DIRECT', 'DOMAIN,example.com,PROXY', 'https://example.com/path', '192.0.2.1/99', 'IP-CIDR6,192.0.2.1/24', 'example.com/path', 'IP-CIDR,192.0.2.1/24/2']) {
    assert.throws(() => normalizeDirectWhitelist([bad]), (e) => e.status === 400, bad);
  }
  assert.throws(() => normalizeDirectWhitelist(null), (e) => e.status === 400);
});
