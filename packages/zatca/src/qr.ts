export interface QrFields {
  sellerName: string;
  vatNumber: string;
  /** "YYYY-MM-DDTHH:mm:ss" from IssueDate + IssueTime. */
  timestamp: string;
  totalWithVat: string;
  vatTotal: string;
  invoiceHash: string;
  signature: string;
  publicKeyDer: Buffer;
  /** Simplified invoices and their notes only. */
  certificateSignatureDer?: Buffer;
}

/** Phase 2 QR: base64 TLV, tags 1–7 as UTF-8 text, 8–9 as raw DER bytes. */
export function buildQr(f: QrFields): string {
  const entries: Array<[number, Buffer]> = [
    [1, Buffer.from(f.sellerName, "utf8")],
    [2, Buffer.from(f.vatNumber, "utf8")],
    [3, Buffer.from(f.timestamp, "utf8")],
    [4, Buffer.from(f.totalWithVat, "utf8")],
    [5, Buffer.from(f.vatTotal, "utf8")],
    [6, Buffer.from(f.invoiceHash, "utf8")],
    [7, Buffer.from(f.signature, "utf8")],
    [8, f.publicKeyDer],
  ];
  if (f.certificateSignatureDer) entries.push([9, f.certificateSignatureDer]);

  const parts: Buffer[] = [];
  for (const [tag, value] of entries) {
    if (value.length > 255) throw new Error(`QR tag ${tag} is ${value.length} bytes; the limit is 255`);
    parts.push(Buffer.from([tag, value.length]), value);
  }
  return Buffer.concat(parts).toString("base64");
}

export function decodeQr(base64: string): Map<number, Buffer> {
  const buf = Buffer.from(base64, "base64");
  const out = new Map<number, Buffer>();
  for (let i = 0; i < buf.length; ) {
    const tag = buf[i]!;
    const len = buf[i + 1]!;
    out.set(tag, buf.subarray(i + 2, i + 2 + len));
    i += 2 + len;
  }
  return out;
}
