// Service-specific rules take precedence over company-wide and country lists.
// Base rule-set documentation: https://github.com/Loyalsoldier/clash-rules
export const GROUP = Object.freeze({
  ai: '🤖 AI 平台', intelligence: '🍎 Apple-智能', youtube: '🎬 YouTube',
  netflix: '🎬 Netflix', hbo: '🎬 HBO', disney: '🎬 Disney+', prime: '🎬 Prime Video',
  google: '🔎 Google', mail: '📪 邮件服务', japan: 'JP 日本区域',
  icloud: '☁️ iCloud', apple: '🍎 苹果服务', microsoft: '🧩 微软服务',
  domestic: '📺 国内流媒体', final: '🐟 漏网之鱼', ads: '🛡 广告拦截',
});

export const APPLE_INTELLIGENCE_DOMAINS = [
  'gateway.icloud.com', 'apple-relay.apple.com', 'apple-relay.fastly-edge.com',
  'apple-relay.cloudflare.com', 'guzzoni.apple.com', 'cp4.cloudflare.com',
  'gspe1-ssl.ls.apple.com', 'smoot.apple.com', 'apple-relay.akamaized.net',
  'apple-relay.mask.apple-dns.net', 'aapps.mzstatic.com',
];

const DOMAINS = {
  ai: [
    'openai.com', 'chatgpt.com', 'chat.com', 'oaistatic.com', 'oaiusercontent.com', 'sora.com',
    'chatgpt.livekit.cloud', 'host.livekit.cloud', 'turn.livekit.cloud', 'openai.azure.com',
    'anthropic.com', 'claude.ai', 'claude.com', 'claudeusercontent.com', 'claude.code',
    'perplexity.ai', 'perplexity.com', 'pplx.ai', 'poe.com', 'grok.com', 'x.ai',
    'gemini.google.com', 'aistudio.google.com', 'ai.google.dev', 'makersuite.google.com',
    'generativelanguage.googleapis.com', 'aiplatform.googleapis.com', 'generativeai.google',
    'alkalimakersuite-pa.clients6.google.com', 'proactivebackend-pa.googleapis.com',
    'notebooklm.google.com', 'notebooklm.google', 'labs.google', 'jules.google',
    'copilot.microsoft.com', 'githubcopilot.com', 'copilot-proxy.githubusercontent.com',
    'mistral.ai', 'cohere.com', 'cohere.ai', 'groq.com', 'together.ai', 'together.xyz',
    'openrouter.ai', 'huggingface.co', 'hf.co', 'meta.ai', 'ai.meta.com',
    'cursor.com', 'cursor.sh', 'windsurf.com', 'codeium.com',
  ],
  youtube: ['youtube.com', 'youtu.be', 'youtube-nocookie.com', 'googlevideo.com', 'ytimg.com', 'ggpht.com', 'youtubei.googleapis.com', 'youtube.googleapis.com', 'withyoutube.com'],
  netflix: ['netflix.com', 'netflix.net', 'nflxvideo.net', 'nflximg.net', 'nflximg.com', 'nflxso.net', 'nflxext.com', 'netflixdnstest.com'],
  hbo: ['hbo.com', 'hbomax.com', 'max.com', 'hboasia.com', 'hbogo.com', 'hbogoasia.com', 'hbogoasia.hk', 'hbogoasia.tw', 'hbonow.com', 'hbo.map.fastly.net', 'hbo.com.edgesuite.net', 'hbomaxcdn.com', 'h264.io', 'discomax.com', 'maxgo.com'],
  disney: ['disneyplus.com', 'disney-plus.net', 'dssott.com', 'bamgrid.com', 'disneystreaming.com'],
  prime: ['primevideo.com', 'aiv-cdn.net', 'aiv-delivery.net', 'amazonvideo.com'],
  mail: [
    'mail.google.com', 'gmail.com', 'googlemail.com', 'gmail.googleapis.com',
    'outlook.com', 'outlook.office.com', 'outlook.office365.com', 'smtp.office365.com',
    'imap-mail.outlook.com', 'smtp-mail.outlook.com', 'hotmail.com',
    'proton.me', 'protonmail.com', 'pm.me', 'mail.ru', 'mail.yahoo.com',
    'fastmail.com', 'tutanota.com', 'tuta.com', 'mail.icloud.com',
    'imap.mail.me.com', 'smtp.mail.me.com', 'mail.qq.com', 'exmail.qq.com', '163.com', '126.com',
  ],
  japan: ['abema.tv', 'abema.io', 'abema-tv.com', 'abematv.akamaized.net', 'tver.jp', 'tver.co.jp', 'unext.jp', 'hulu.jp', 'radiko.jp', 'music.jp', 'paravi.jp', 'telasa.jp', 'wowow.co.jp', 'dmm.com', 'dmm.co.jp', 'niconico.com', 'nicovideo.jp', 'nimg.jp'],
  domestic: ['bilibili.com', 'bilibili.tv', 'biliapi.net', 'biliapi.com', 'bilivideo.com', 'bilivideo.cn', 'hdslb.com', 'b23.tv', 'acgvideo.com', 'v.qq.com', 'video.qq.com', 'qqlive.com', 'qqvideo.tc.qq.com', 'youku.com', 'ykimg.com', 'tudou.com', 'mgtv.com', 'iqiyi.com', 'iqiyipic.com', 'qiyi.com', 'qiyipic.com', 'cctv.com', 'cctv.cn', 'cntv.cn'],
  icloud: ['icloud.com', 'icloud.com.cn', 'icloud-content.com', 'me.com'],
  apple: ['apple.com', 'apple.com.cn', 'mzstatic.com', 'aaplimg.com', 'apple-cloudkit.com', 'apple-dns.net'],
  microsoft: ['microsoft.com', 'microsoftonline.com', 'microsoft.net', 'office.com', 'office365.com', 'office.net', 'live.com', 'live.net', 'onedrive.com', 'onedrive.live.com', 'sharepoint.com', 'windows.com', 'windows.net', 'windowsupdate.com', 'msn.com', 'bing.com', 'bing.net', 'bingapis.com', 'azure.com', 'azureedge.net', 'xbox.com', 'xboxlive.com'],
  google: ['google.com', 'googleapis.com', 'googleusercontent.com', 'gstatic.com', 'gvt1.com', 'gvt2.com', 'gvt0.com', 'gvt3.com', 'gvt6.com', 'google.co.jp', 'google.com.hk', 'google.com.tw', 'google.co.uk', 'google.de', 'google.fr', 'googlevideo.com', 'android.com', 'g.co', 'services.googleapis.cn'],
};

// iOS Network Extensions have a tight memory budget. MRS loads compiled tries
// directly instead of expanding hundreds of thousands of YAML strings at startup.
// These are MetaCubeX categories, not byte-for-byte copies of Loyalsoldier lists.
const MOBILE_RULES = {
  reject: 'geosite/category-ads-all', icloud: 'geosite/icloud',
  apple: 'geosite/apple', google: 'geosite/google@cn',
  proxy: 'geosite/geolocation-!cn', direct: 'geosite/cn', private: 'geosite/private',
  lancidr: 'geoip/private', cncidr: 'geoip/cn', jpcidr: 'geoip/jp',
};

export function ruleProviders(device = 'android') {
  if (device === 'ios') return Object.fromEntries(Object.entries(MOBILE_RULES).map(([name, resource]) => [
    `mobile-${name}`, {
      type: 'http', behavior: name.endsWith('cidr') ? 'ipcidr' : 'domain', format: 'mrs',
      url: `https://cdn.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta/geo/${resource}.mrs`,
      path: `./ruleset/mobile-${name}.mrs`, interval: 86400,
    },
  ]));
  return Object.fromEntries(['reject', 'icloud', 'apple', 'google', 'proxy', 'direct', 'private', 'lancidr', 'cncidr'].map((name) => [
    `loyal-${name}`, {
      type: 'http', behavior: name.endsWith('cidr') ? 'ipcidr' : 'domain', format: 'yaml',
      url: `https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/${name}.txt`,
      path: `./ruleset/loyal-${name}.yaml`, interval: 86400,
    },
  ]));
}

function targetFor(group) {
  if (/(Apple Intelligence|Apple-智能|苹果智能)/i.test(group)) return GROUP.intelligence;
  if (/(\bAI\b|人工智能|ChatGPT|Claude|Gemini|Grok|Perplexity)/i.test(group)) return GROUP.ai;
  if (/YouTube/i.test(group)) return GROUP.youtube;
  if (/Netflix/i.test(group)) return GROUP.netflix;
  if (/(HBO|\bMax\b)/i.test(group)) return GROUP.hbo;
  if (/Disney/i.test(group)) return GROUP.disney;
  if (/PrimeVideo|Prime Video/i.test(group)) return GROUP.prime;
  if (/(邮件|Mail)/i.test(group)) return GROUP.mail;
  if (/(日本|Japan)/i.test(group)) return GROUP.japan;
  if (/iCloud/i.test(group)) return GROUP.icloud;
  if (/(苹果|Apple)/i.test(group)) return GROUP.apple;
  if (/(微软|Microsoft|OneDrive|Bing)/i.test(group)) return GROUP.microsoft;
  if (/Google/i.test(group)) return GROUP.google;
  if (/(国内流媒体|B站|哔哩|爱奇艺|腾讯视频)/i.test(group)) return GROUP.domestic;
  if (/(广告|AdBlock|Advertising)/i.test(group)) return GROUP.ads;
  if (/(国内网站|China|Mainland)/i.test(group)) return 'DIRECT';
  return GROUP.final;
}

// Only self-contained rules are inherited. GeoSite and upstream RULE-SET references
// depend on databases/providers that are not carried over to the generated config.
function upstreamRules(source) {
  const targets = new Map(source.groups.map(({ name }) => [name, targetFor(name)]));
  const selected = [];
  for (const raw of source.rules) {
    const parts = raw.split(',').map((part) => part.trim());
    const [type, value, action, flag] = parts;
    if (!['DOMAIN', 'DOMAIN-SUFFIX', 'DOMAIN-KEYWORD', 'IP-CIDR', 'IP-CIDR6'].includes(type)) continue;
    if (parts.length < 3 || parts.length > 4 || (flag && flag !== 'no-resolve')) continue;
    const target = targets.get(action) || (['DIRECT', 'REJECT', 'REJECT-DROP'].includes(action) ? action : GROUP.final);
    // Avoid turning all Tencent services into streaming through SSONE's broad qq.com rule.
    if (target === GROUP.domestic && value === 'qq.com') continue;
    selected.push([type, value, target, ...(flag ? [flag] : [])].join(','));
  }
  return selected;
}

export function routingRules(source, options) {
  const intelligence = APPLE_INTELLIGENCE_DOMAINS.map((domain) => `DOMAIN-SUFFIX,${domain},${GROUP.intelligence}`);
  const builtIn = Object.entries(DOMAINS).flatMap(([key, domains]) => domains.map((domain) => `DOMAIN-SUFFIX,${domain},${GROUP[key]}`));
  const inherited = options.includeUpstreamRules === false ? [] : upstreamRules(source);
  const unique = new Map();
  for (const rule of [...intelligence, ...builtIn, ...inherited]) {
    const [type, value] = rule.split(',');
    const identity = `${type},${value}`;
    if (!unique.has(identity)) unique.set(identity, rule);
  }
  const serviceRules = [...unique.values()].filter((rule) => !intelligence.includes(rule));
  // More specific domains first, so inherited mail/API/CDN rules are not shadowed
  // by google.com, apple.com, microsoft.com, etc. Exact beats suffix at equal depth.
  const rank = (rule) => {
    const [type, value] = rule.split(',');
    return type === 'DOMAIN' || type === 'DOMAIN-SUFFIX' ? value.split('.').length * 2 + (type === 'DOMAIN' ? 1 : 0) : 0;
  };
  serviceRules.sort((a, b) => rank(b) - rank(a));
  const rules = [
    ...options.directRules,
    ...intelligence,
    'RULE-SET,loyal-private,DIRECT',
    `RULE-SET,loyal-reject,${GROUP.ads}`,
    ...serviceRules,
    `RULE-SET,loyal-icloud,${GROUP.icloud}`,
    `RULE-SET,loyal-apple,${GROUP.apple}`,
    `RULE-SET,loyal-google,${GROUP.google}`,
    `DOMAIN-SUFFIX,jp,${GROUP.japan}`,
    'RULE-SET,loyal-direct,DIRECT',
    `RULE-SET,loyal-proxy,${GROUP.final}`,
    'RULE-SET,loyal-lancidr,DIRECT,no-resolve',
    'RULE-SET,loyal-cncidr,DIRECT,no-resolve',
    `GEOIP,JP,${GROUP.japan},no-resolve`,
    `MATCH,${GROUP.final}`,
  ];
  if (options.device !== 'ios') return rules;
  return rules.map((rule) => rule === `GEOIP,JP,${GROUP.japan},no-resolve`
    ? `RULE-SET,mobile-jpcidr,${GROUP.japan},no-resolve`
    : rule.replace(/^RULE-SET,loyal-/, 'RULE-SET,mobile-'));
}
