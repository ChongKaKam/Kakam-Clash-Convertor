import dns from 'node:dns/promises';
import net from 'node:net';
import { HttpError } from './errors.js';

function isPrivateIp(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (net.isIPv6(address)) {
    const ip = address.toLowerCase();
    if (ip.startsWith('::ffff:')) return isPrivateIp(ip.slice(7));
    return ip === '::' || ip === '::1' || ip.startsWith('fc') || ip.startsWith('fd') ||
      ip.startsWith('fe8') || ip.startsWith('fe9') || ip.startsWith('fea') || ip.startsWith('feb') || ip.startsWith('ff');
  }
  return true;
}

async function validateUrl(rawUrl, allowPrivate) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new HttpError(400, '订阅地址不是有效 URL');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new HttpError(400, '订阅地址只允许 HTTP 或 HTTPS');
  }
  if (url.username || url.password) throw new HttpError(400, '订阅地址不能包含 URL 用户名或密码');
  if (allowPrivate) return url;

  let addresses;
  try {
    addresses = await dns.lookup(url.hostname, { all: true, verbatim: true });
  } catch {
    throw new HttpError(502, '无法解析订阅服务器域名');
  }
  if (!addresses.length || addresses.some(({ address }) => isPrivateIp(address))) {
    throw new HttpError(400, '订阅地址不能指向本机或内网地址');
  }
  return url;
}

export async function fetchSubscription(rawUrl, options) {
  let url = await validateUrl(rawUrl, options.allowPrivate);
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    let response;
    try {
      response = await fetch(url, {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'user-agent': 'ClashMeta/1.19 clash-subscription-converter/1.0',
          accept: 'text/yaml,text/plain,application/yaml,*/*',
        },
      });
    } catch (error) {
      if (error.name === 'AbortError') throw new HttpError(504, '拉取订阅超时');
      throw new HttpError(502, `拉取订阅失败：${error.message}`);
    } finally {
      clearTimeout(timer);
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (redirects === 3) throw new HttpError(502, '订阅重定向次数过多');
      const location = response.headers.get('location');
      if (!location) throw new HttpError(502, '订阅重定向缺少目标地址');
      url = await validateUrl(new URL(location, url).href, options.allowPrivate);
      continue;
    }
    if (!response.ok) throw new HttpError(502, `订阅服务器返回 HTTP ${response.status}`);
    const announced = Number(response.headers.get('content-length') || 0);
    if (announced > options.maxBytes) throw new HttpError(413, '订阅内容超过大小限制');
    if (!response.body) throw new HttpError(502, '订阅服务器返回空响应');

    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > options.maxBytes) {
        await reader.cancel();
        throw new HttpError(413, '订阅内容超过大小限制');
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  }
  throw new HttpError(502, '无法完成订阅拉取');
}
