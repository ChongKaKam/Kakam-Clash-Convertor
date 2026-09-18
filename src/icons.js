import { deflateSync } from 'node:zlib';

// Self-contained PNG badges: no flag-emoji font or third-party icon host required.
const FONT = {
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  J: ['00111', '00010', '00010', '00010', '10010', '10010', '01100'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
};
export const REGION_COLORS = { hk: '#bf5061', tw: '#4476bf', us: '#7965c2', jp: '#b76485' };

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(name, data) {
  const type = Buffer.from(name);
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length); type.copy(result, 4); data.copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([type, data])), result.length - 4);
  return result;
}
function badge(region) {
  const size = 96, scale = 5;
  const color = REGION_COLORS[region].slice(1).match(/../g).map((hex) => parseInt(hex, 16));
  const raw = Buffer.alloc(size * (1 + size * 4));
  const letters = region.toUpperCase();
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const offset = y * (1 + size * 4) + 1 + x * 4;
    let rgb = color;
    for (let i = 0; i < 2; i++) {
      const gx = Math.floor((x - 20 - i * 30) / scale), gy = Math.floor((y - 30) / scale);
      if (gx >= 0 && gx < 5 && gy >= 0 && gy < 7 && FONT[letters[i]][gy][gx] === '1') rgb = [255, 255, 255];
    }
    const dx = Math.max(16 - x, x - 79, 0), dy = Math.max(16 - y, y - 79, 0);
    raw[offset] = rgb[0]; raw[offset + 1] = rgb[1]; raw[offset + 2] = rgb[2];
    raw[offset + 3] = dx * dx + dy * dy <= 256 ? 255 : 0;
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
export const REGION_ICONS = Object.fromEntries(Object.keys(REGION_COLORS).map((key) => [key, badge(key)]));
