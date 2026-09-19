import YAML from 'yaml';
import { parseSubscription } from './parser.js';
import { GROUP, ruleProviders, routingRules } from './routing.js';
import { directWhitelistRules } from './settings.js';
import { HttpError } from './errors.js';

export const REGIONS = [
  { key: 'hk', name: 'HK 香港自动', pattern: /(香港|港|Hong\s*Kong|\bHK\b|🇭🇰)/i },
  { key: 'tw', name: 'TW 台湾自动', pattern: /(台湾|台灣|Taiwan|\bTW\b|🇹🇼)/i },
  { key: 'us', name: 'US 美国自动', pattern: /(美国|美國|United\s*States|America|\bUS(?:A)?\b|🇺🇸)/i },
  { key: 'jp', name: 'JP 日本自动', pattern: /(日本|Japan|Tokyo|Osaka|\bJP\b|🇯🇵)/i },
];

export const AI_AUTO_GROUP = '🌈 AI 自动';
export const APPLE_INTELLIGENCE_AUTO_GROUP = '🍎 Apple智能自动';
const AI_AUTO_SERVICE_GROUPS = new Set(['ai', 'intelligence', 'icloud', 'apple']);

const BASE = {
  'mixed-port': 7890,
  'allow-lan': true,
  'bind-address': '*',
  mode: 'rule',
  'log-level': 'warning',
  ipv6: false,
  'unified-delay': true,
  'tcp-concurrent': true,
  profile: { 'store-selected': true, 'store-fake-ip': true },
};

function deviceSettings(device) {
  const dns = {
    enable: true, ipv6: false, 'enhanced-mode': 'fake-ip', 'fake-ip-range': '198.18.0.1/16',
    'default-nameserver': ['223.5.5.5', '119.29.29.29'],
    nameserver: ['https://dns.alidns.com/dns-query', 'https://doh.pub/dns-query'],
    'proxy-server-nameserver': ['https://dns.alidns.com/dns-query', 'https://doh.pub/dns-query'],
    'fake-ip-filter': ['+.lan', '+.local', 'localhost.ptlogin2.qq.com', '+.push.apple.com', '+.srv.nintendo.net'],
  };
  if (device === 'tvos') return { dns, sniffer: { enable: false }, tun: { enable: false } };
  if (device === 'ios') return {
    dns: { ...dns, listen: '0.0.0.0:1053' },
    sniffer: { enable: true, 'force-dns-mapping': true, 'parse-pure-ip': true, 'override-destination': false, sniff: { TLS: { ports: [443, 8443] }, HTTP: { ports: ['80', '8080-8880'] } } },
    tun: { enable: false, stack: 'mixed', 'auto-route': true, 'auto-detect-interface': true },
  };
  return {
    dns: { ...dns, listen: '0.0.0.0:1053', 'respect-rules': true },
    sniffer: { enable: true, 'force-dns-mapping': true, 'parse-pure-ip': true, 'override-destination': true, sniff: { TLS: { ports: [443, 8443] }, HTTP: { ports: ['80', '8080-8880'] }, QUIC: { ports: [443, 8443] } } },
    tun: { enable: true, stack: 'mixed', 'dns-hijack': ['any:53'], 'auto-route': true, 'auto-detect-interface': true },
  };
}

function uniqueNames(proxies) {
  const seen = new Map();
  return proxies.map((proxy) => {
    const original = String(proxy.name).trim();
    const count = (seen.get(original) || 0) + 1;
    seen.set(original, count);
    return { ...proxy, name: count === 1 ? original : `${original} #${count}` };
  });
}

function eligible(proxy) {
  const name = String(proxy.name);
  return /^(pro-|直连-)/i.test(name) && REGIONS.some(({ pattern }) => pattern.test(name));
}

function deviceCompatibleProxy(proxy, device) {
  if (device !== 'tvos' && String(proxy.type).toLowerCase() === 'mieru' && proxy.udp == null) {
    // Mihomo defaults the common `udp` capability to false. Mieru can carry
    // SOCKS5 UDP Associate over its configured transport, but only when this
    // flag is enabled. Preserve an explicit upstream `udp: false`.
    return { ...proxy, udp: true };
  }
  return proxy;
}

export function buildSubscription(text, device = 'android', options = {}) {
  if (!['tvos', 'ios', 'android'].includes(device)) throw new HttpError(400, '设备必须是 tvos、ios 或 android');
  const source = parseSubscription(text);
  const proxies = uniqueNames(source.proxies.filter((proxy) => eligible(proxy) &&
    !(device === 'tvos' && String(proxy.type).toLowerCase() === 'mieru'))
    .map((proxy) => deviceCompatibleProxy(proxy, device)));
  if (!proxies.length) throw new HttpError(422, device === 'tvos'
    ? 'tvOS 过滤 Mieru 后没有可用的港台美日 pro-* / 直连-* 节点'
    : '订阅中没有匹配 pro-* 或 直连-* 且属于香港、台湾、美国、日本的节点');

  const regionNames = Object.fromEntries(REGIONS.map((region) => [
    region.key,
    proxies.filter((proxy) => region.pattern.test(proxy.name)).map((proxy) => proxy.name),
  ]));
  const nonEmptyGroups = REGIONS.filter((region) => regionNames[region.key].length);
  const allNames = proxies.map((proxy) => proxy.name);
  const autoGroups = nonEmptyGroups.map((region) => ({
    name: region.name, type: 'url-test', proxies: regionNames[region.key],
    url: 'https://www.gstatic.com/generate_204', interval: 300, tolerance: 80, lazy: true,
  }));
  const autoNames = autoGroups.map((group) => group.name);
  // Filter after device compatibility checks; never add DIRECT or other US nodes.
  const aiNames = allNames.filter((name) => name.startsWith('直连-美国'));
  const aiAuto = aiNames.length ? {
    name: AI_AUTO_GROUP, type: 'url-test', proxies: aiNames,
    url: 'https://www.gstatic.com/generate_204', interval: 300, tolerance: 80, lazy: true,
  } : null;
  const appleIntelligenceAuto = aiNames.length ? {
    name: APPLE_INTELLIGENCE_AUTO_GROUP, type: 'url-test', proxies: aiNames,
    url: 'https://ios.chat.openai.com/', 'expected-status': 403,
    interval: 300, tolerance: 80, lazy: true,
  } : null;
  const preferred = (key) => regionNames[key].length ? REGIONS.find((region) => region.key === key).name : undefined;
  const compact = (values) => [...new Set(values.filter(Boolean))];

  const serviceGroup = (key, first = []) => ({
    name: GROUP[key], type: 'select',
    proxies: compact([...first, ...(AI_AUTO_SERVICE_GROUPS.has(key) && aiAuto ? [aiAuto.name] : []), '🚀 节点选择', ...autoNames, 'DIRECT', ...allNames]),
  });
  const groups = [
    { name: '🚀 节点选择', type: 'select', proxies: compact([...autoNames, ...allNames, 'DIRECT']) },
    ...autoGroups,
    ...(aiAuto ? [aiAuto] : []),
    ...(appleIntelligenceAuto ? [appleIntelligenceAuto] : []),
    serviceGroup('ai', [aiAuto?.name, appleIntelligenceAuto?.name, preferred('us'), preferred('tw'), preferred('jp')]),
    serviceGroup('intelligence', [appleIntelligenceAuto?.name, aiAuto?.name, preferred('us'), preferred('jp'), preferred('tw')]),
    serviceGroup('youtube'), serviceGroup('netflix'), serviceGroup('hbo', [preferred('us')]),
    serviceGroup('disney'), serviceGroup('prime'), serviceGroup('google'), serviceGroup('mail'),
    serviceGroup('japan', [preferred('jp')]),
    serviceGroup('icloud', ['DIRECT']), serviceGroup('apple', ['DIRECT']),
    serviceGroup('microsoft', ['DIRECT']), serviceGroup('domestic', ['DIRECT']),
    serviceGroup('final'), serviceGroup('ads', ['REJECT', 'DIRECT']),
  ];
  const rules = routingRules(source, { ...options, device, directRules: directWhitelistRules(options.directWhitelist) });
  if (options.publicBaseUrl) {
    for (const group of groups) {
      const region = REGIONS.find((region) => region.name === group.name)?.key || (group.name === GROUP.japan ? 'jp' : null);
      if (region) group.icon = `${options.publicBaseUrl.replace(/\/$/, '')}/icons/${region}.png`;
    }
  }

  return { ...BASE, ...deviceSettings(device), proxies, 'proxy-groups': groups, 'rule-providers': ruleProviders(device), rules };
}

export function convertSubscription(text, device = 'android', options = {}) {
  return YAML.stringify(buildSubscription(text, device, options), { lineWidth: 0, defaultKeyType: 'PLAIN', defaultStringType: 'PLAIN' });
}

export function subscriptionPreview(built, device) {
  const groups = built['proxy-groups'];
  return {
    device,
    nodes: built.proxies.map(({ name, type }) => ({ name, type, region: REGIONS.find((region) => region.pattern.test(name))?.key ?? 'other' })),
    groups: groups.map((group) => ({
      name: group.name, type: group.type, members: group.proxies,
      default: group.type === 'select' ? group.proxies[0] : null,
      region: REGIONS.find((region) => region.name === group.name)?.key || (group.name === GROUP.japan ? 'jp' : null),
      ruleCount: built.rules.filter((rule) => {
        const parts = rule.split(',');
        return (parts.at(-1) === 'no-resolve' ? parts.at(-2) : parts.at(-1)) === group.name;
      }).length,
    })),
    ruleCount: built.rules.length,
  };
}

export function summarizeSubscription(text) {
  const parsed = parseSubscription(text);
  const selected = parsed.proxies.filter(eligible);
  return {
    proxyCount: parsed.proxies.length,
    selectedCount: selected.length,
    ruleCount: parsed.rules.length,
    regions: Object.fromEntries(REGIONS.map((region) => [region.key, selected.filter((proxy) => region.pattern.test(proxy.name)).length])),
  };
}
