import YAML from 'yaml';
import { HttpError } from './errors.js';

function decodeBase64(value) {
  const normalized = value.replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized, 'base64').toString('utf8');
}

function safeDecode(value) {
  try { return decodeURIComponent(value); } catch { return value; }
}

function uriName(url, fallback) {
  return safeDecode(url.hash.slice(1)) || fallback;
}

function parseVmess(line) {
  const raw = line.slice('vmess://'.length).split('#')[0];
  const value = JSON.parse(decodeBase64(raw));
  const proxy = {
    name: value.ps || `${value.add}:${value.port}`,
    type: 'vmess', server: value.add, port: Number(value.port), uuid: value.id,
    alterId: Number(value.aid || 0), cipher: value.scy || 'auto', udp: true,
  };
  if (value.net) proxy.network = value.net;
  if (value.tls === 'tls') proxy.tls = true;
  if (value.sni) proxy.servername = value.sni;
  if (value.host || value.path) proxy['ws-opts'] = { path: value.path || '/', headers: value.host ? { Host: value.host } : undefined };
  return proxy;
}

function parseSs(line) {
  const body = line.slice(5);
  const [withoutHash, hash = ''] = body.split('#', 2);
  let authority = withoutHash.split('?')[0];
  if (!authority.includes('@')) authority = decodeBase64(authority);
  const at = authority.lastIndexOf('@');
  const credentials = authority.slice(0, at).includes(':') ? authority.slice(0, at) : decodeBase64(authority.slice(0, at));
  const separator = credentials.indexOf(':');
  const target = new URL(`tcp://${authority.slice(at + 1)}`);
  return {
    name: safeDecode(hash) || `${target.hostname}:${target.port}`,
    type: 'ss', server: target.hostname, port: Number(target.port),
    cipher: credentials.slice(0, separator), password: credentials.slice(separator + 1), udp: true,
  };
}

function parseUrlProxy(line) {
  const url = new URL(line);
  const type = url.protocol.slice(0, -1);
  const proxy = {
    name: uriName(url, `${url.hostname}:${url.port}`), type,
    server: url.hostname, port: Number(url.port), udp: true,
  };
  if (type === 'vless') proxy.uuid = safeDecode(url.username);
  if (type === 'trojan') proxy.password = safeDecode(url.username);
  if (type === 'hysteria2' || type === 'hy2') {
    proxy.type = 'hysteria2';
    proxy.password = safeDecode(url.username || url.password);
  }
  if (type === 'tuic') {
    proxy.uuid = safeDecode(url.username);
    proxy.password = safeDecode(url.password);
  }
  const params = url.searchParams;
  if (params.get('security') === 'tls' || params.get('security') === 'reality' || ['trojan', 'hysteria2', 'hy2', 'tuic'].includes(type)) proxy.tls = true;
  if (params.get('sni')) proxy.servername = params.get('sni');
  if (params.get('flow')) proxy.flow = params.get('flow');
  if (params.get('type')) proxy.network = params.get('type');
  if (params.get('fp')) proxy['client-fingerprint'] = params.get('fp');
  if (params.get('allowInsecure') === '1' || params.get('insecure') === '1') proxy['skip-cert-verify'] = true;
  if (proxy.network === 'ws') {
    proxy['ws-opts'] = { path: params.get('path') || '/', headers: params.get('host') ? { Host: params.get('host') } : undefined };
  }
  if (params.get('security') === 'reality') {
    proxy['reality-opts'] = { 'public-key': params.get('pbk'), 'short-id': params.get('sid') || '' };
  }
  return proxy;
}

function parseUris(text) {
  let decoded = text.trim();
  if (!decoded.includes('://')) {
    try { decoded = decodeBase64(decoded); } catch { /* handled below */ }
  }
  const proxies = [];
  for (const line of decoded.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
    try {
      if (line.startsWith('vmess://')) proxies.push(parseVmess(line));
      else if (line.startsWith('ss://')) proxies.push(parseSs(line));
      else if (/^(vless|trojan|hysteria2|hy2|tuic):\/\//.test(line)) proxies.push(parseUrlProxy(line));
    } catch { /* ignore a malformed individual node */ }
  }
  return { proxies, rules: [], groups: [] };
}

export function parseSubscription(text) {
  try {
    const document = YAML.parse(text);
    if (document && Array.isArray(document.proxies)) {
      return {
        proxies: document.proxies.filter((proxy) => proxy && typeof proxy === 'object' && proxy.name && proxy.type),
        rules: Array.isArray(document.rules) ? document.rules.filter((rule) => typeof rule === 'string') : [],
        groups: Array.isArray(document['proxy-groups']) ? document['proxy-groups'].filter((group) => group?.name) : [],
      };
    }
  } catch { /* URI subscriptions are not YAML documents */ }
  const parsed = parseUris(text);
  if (!parsed.proxies.length) throw new HttpError(422, '无法识别订阅格式，需为 Clash YAML 或常见节点 URI/Base64 订阅');
  return parsed;
}
