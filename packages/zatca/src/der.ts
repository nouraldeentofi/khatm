// Minimal DER reader/writer: enough to pull the signature out of a certificate and to
// build a PKCS#10 CSR. Not a general ASN.1 library.

export interface Tlv {
  tag: number;
  /** Full encoding, header included. */
  raw: Buffer;
  /** Contents only. */
  value: Buffer;
}

export function readTlv(buf: Buffer, offset = 0): Tlv & { end: number } {
  const tag = buf[offset]!;
  let len = buf[offset + 1]!;
  let header = 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n === 0 || n > 4) throw new Error("Unsupported DER length");
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + buf[offset + 2 + i]!;
    header += n;
  }
  const end = offset + header + len;
  if (end > buf.length) throw new Error("Truncated DER");
  return { tag, raw: buf.subarray(offset, end), value: buf.subarray(offset + header, end), end };
}

export function readChildren(value: Buffer): Tlv[] {
  const out: Tlv[] = [];
  for (let off = 0; off < value.length; ) {
    const t = readTlv(value, off);
    out.push(t);
    off = t.end;
  }
  return out;
}

function encodeLength(len: number): Buffer {
  if (len < 0x80) return Buffer.from([len]);
  const bytes: number[] = [];
  for (let n = len; n > 0; n = Math.floor(n / 256)) bytes.unshift(n & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

export function tlv(tag: number, ...contents: Buffer[]): Buffer {
  const body = Buffer.concat(contents);
  return Buffer.concat([Buffer.from([tag]), encodeLength(body.length), body]);
}

export const seq = (...c: Buffer[]) => tlv(0x30, ...c);
export const set = (...c: Buffer[]) => tlv(0x31, ...c);
export const integer = (n: number) => tlv(0x02, Buffer.from([n]));
export const octetString = (b: Buffer) => tlv(0x04, b);
export const bitString = (b: Buffer) => tlv(0x03, Buffer.from([0]), b);
export const utf8String = (s: string) => tlv(0x0c, Buffer.from(s, "utf8"));
export const printableString = (s: string) => tlv(0x13, Buffer.from(s, "ascii"));
export const contextConstructed = (n: number, ...c: Buffer[]) => tlv(0xa0 | n, ...c);

export function oid(dotted: string): Buffer {
  const parts = dotted.split(".").map(Number);
  const bytes: number[] = [40 * parts[0]! + parts[1]!];
  for (const p of parts.slice(2)) {
    const chunk: number[] = [p & 0x7f];
    for (let n = Math.floor(p / 128); n > 0; n = Math.floor(n / 128)) chunk.unshift((n & 0x7f) | 0x80);
    bytes.push(...chunk);
  }
  return tlv(0x06, Buffer.from(bytes));
}
