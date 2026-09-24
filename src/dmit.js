import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { HttpError } from './errors.js';

export const DMIT_VLESS = 'DMIT-US';
export const DMIT_HYSTERIA2 = 'DMIT-US-Hysteria2';

// Credentials live in the private data volume, never in source code or previews.
// Read on each conversion so edits also apply to existing subscription links.
export async function readDmitProxies(dataDir) {
  let text;
  try { text = await fs.readFile(path.join(dataDir, 'dmit.yaml'), 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  try {
    const document = YAML.parse(text);
    const proxies = Array.isArray(document) ? document : document?.proxies;
    if (!Array.isArray(proxies) || !proxies.length || proxies.length > 2) throw new Error();
    const seen = new Set();
    return proxies.map((proxy) => {
      if (!proxy || !['vless', 'hysteria2'].includes(proxy.type) || seen.has(proxy.type) ||
          typeof proxy.server !== 'string' || !proxy.server.trim() ||
          !Number.isInteger(proxy.port) || proxy.port < 1 || proxy.port > 65535) throw new Error();
      seen.add(proxy.type);
      if (proxy.type === 'vless' && (typeof proxy.uuid !== 'string' || !proxy.uuid ||
          proxy.tls !== true || !proxy['reality-opts']?.['public-key'])) throw new Error();
      if (proxy.type === 'hysteria2' && (typeof proxy.password !== 'string' || !proxy.password)) throw new Error();
      return { ...proxy, name: proxy.type === 'vless' ? DMIT_VLESS : DMIT_HYSTERIA2 };
    }).sort((a, b) => Number(b.type === 'vless') - Number(a.type === 'vless'));
  } catch {
    // YAML parser errors can contain credentials; expose only a fixed message.
    throw new HttpError(500, 'dmit.yaml 无效：需提供 VLESS + REALITY / Hysteria2 节点，每种协议最多一个');
  }
}
