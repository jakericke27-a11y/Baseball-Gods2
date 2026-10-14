/**
 * Small zip writer and reader for the game's own files (the art kit, save files). Entries are stored,
 * or deflated with the browser's CompressionStream when asked. Any unzip tool opens them.
 */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(b: Uint8Array): number { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

async function through(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([data as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}
export const deflate = (b: Uint8Array) => through(b, new CompressionStream('deflate-raw'));
export const inflate = (b: Uint8Array) => through(b, new DecompressionStream('deflate-raw'));

export interface ZipEntry { name: string; data: Uint8Array }

/** Build a zip. `compress` deflates entries (async); without it every entry is stored. */
export function zip(files: ZipEntry[]): Uint8Array;
export function zip(files: ZipEntry[], compress: true): Promise<Uint8Array>;
export function zip(files: ZipEntry[], compress?: true): Uint8Array | Promise<Uint8Array> {
  if (!compress) return pack(files.map((f) => ({ ...f, packed: f.data, method: 0 })));
  return Promise.all(files.map(async (f) => ({ ...f, packed: await deflate(f.data), method: 8 }))).then(pack);
}

function pack(files: Array<ZipEntry & { packed: Uint8Array; method: number }>): Uint8Array {
  const enc = new TextEncoder(), parts: Uint8Array[] = [], central: Uint8Array[] = [];
  let off = 0;
  for (const f of files) {
    const name = enc.encode(f.name), crc = crc32(f.data), n = f.data.length, m = f.packed.length;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, f.method, true);
    lh.setUint16(10, 0, true); lh.setUint16(12, 0x21, true); // 1980-01-01: a fixed date keeps identical files identical
    lh.setUint32(14, crc, true); lh.setUint32(18, m, true); lh.setUint32(22, n, true); lh.setUint16(26, name.length, true);
    parts.push(new Uint8Array(lh.buffer), name, f.packed);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, f.method, true);
    ch.setUint16(14, 0x21, true); ch.setUint32(16, crc, true); ch.setUint32(20, m, true); ch.setUint32(24, n, true);
    ch.setUint16(28, name.length, true); ch.setUint32(42, off, true);
    central.push(new Uint8Array(ch.buffer), name);
    off += 30 + name.length + m;
  }
  const cdSize = central.reduce((a, p) => a + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, off, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((a, p) => a + p.length, 0));
  let at = 0; for (const p of all) { out.set(p, at); at += p.length; }
  return out;
}

/** Read a zip (stored or deflated entries). Throws on anything that isn't a well-formed zip. */
export async function unzip(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) if (v.getUint32(i, true) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new Error('not a zip file');
  const count = v.getUint16(end + 10, true);
  let at = v.getUint32(end + 16, true);
  const dec = new TextDecoder(), out = new Map<string, Uint8Array>();
  for (let k = 0; k < count; k++) {
    if (v.getUint32(at, true) !== 0x02014b50) throw new Error('damaged zip file');
    const method = v.getUint16(at + 10, true), crc = v.getUint32(at + 16, true), size = v.getUint32(at + 20, true);
    const nameLen = v.getUint16(at + 28, true), extra = v.getUint16(at + 30, true), comment = v.getUint16(at + 32, true);
    const local = v.getUint32(at + 42, true);
    const name = dec.decode(bytes.subarray(at + 46, at + 46 + nameLen));
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const raw = bytes.subarray(start, start + size);
    const data = method === 0 ? raw.slice() : method === 8 ? await inflate(raw) : null;
    if (!data) throw new Error(`zip entry ${name} uses an unknown compression`);
    if (crc32(data) !== crc) throw new Error(`zip entry ${name} is damaged`);
    out.set(name, data);
    at += 46 + nameLen + extra + comment;
  }
  return out;
}
