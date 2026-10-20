// Browser stand-in for the parts of node:crypto that @khatm/zatca's signing path uses:
// SHA-256, secp256k1 ECDSA signing and X.509 field extraction. The demo bundles the
// real library against this module, so the page runs the same code the server does.
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { readChildren, readTlv, type Tlv } from "../../../packages/zatca/src/der.ts";

type Input = string | Uint8Array;
const bytes = (data: Input, enc?: string) =>
  typeof data === "string" ? Buffer.from(data, (enc ?? "utf8") as BufferEncoding) : Buffer.from(data);

class Hash {
  private chunks: Buffer[] = [];
  update(data: Input, enc?: string) {
    this.chunks.push(bytes(data, enc));
    return this;
  }
  digest(enc?: "hex" | "base64") {
    const out = Buffer.from(sha256(Buffer.concat(this.chunks)));
    return enc ? out.toString(enc) : out;
  }
}

export function createHash(algorithm: string) {
  if (algorithm !== "sha256") throw new Error(`Unsupported hash ${algorithm}`);
  return new Hash();
}

export interface KeyObject {
  secret: Uint8Array;
}

/** Accepts SEC1 ("EC PRIVATE KEY") or PKCS#8 ("PRIVATE KEY") PEM for secp256k1. */
export function createPrivateKey(pem: string): KeyObject {
  const der = Buffer.from(pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, ""), "base64");
  let fields = readChildren(readTlv(der).value);
  if (fields[1]?.tag === 0x30) fields = readChildren(readTlv(fields[2]!.value).value); // PKCS#8 wraps SEC1
  const secret = fields[1];
  if (!secret || secret.tag !== 0x04 || secret.value.length !== 32) throw new Error("Unsupported private key");
  return { secret: new Uint8Array(secret.value) };
}

export function createSign(algorithm: string) {
  if (algorithm !== "sha256") throw new Error(`Unsupported signature hash ${algorithm}`);
  const hash = new Hash();
  return {
    update(data: Input, enc?: string) {
      hash.update(data, enc);
      return this;
    },
    sign(key: KeyObject) {
      const digest = hash.digest() as Buffer;
      return Buffer.from(secp256k1.sign(digest, key.secret, { prehash: false, format: "der" }));
    },
  };
}

const OID_NAMES: Record<string, string> = {
  "2.5.4.3": "CN",
  "2.5.4.6": "C",
  "2.5.4.7": "L",
  "2.5.4.8": "ST",
  "2.5.4.10": "O",
  "2.5.4.11": "OU",
  "0.9.2342.19200300.100.1.25": "DC",
};

function decodeOid(value: Buffer): string {
  const parts = [Math.floor(value[0]! / 40), value[0]! % 40];
  let n = 0;
  for (const b of value.subarray(1)) {
    n = n * 128 + (b & 0x7f);
    if (!(b & 0x80)) {
      parts.push(n);
      n = 0;
    }
  }
  return parts.join(".");
}

function formatName(name: Tlv): string {
  return readChildren(name.value)
    .flatMap((rdn) => readChildren(rdn.value))
    .map((atv) => {
      const [type, value] = readChildren(atv.value);
      const oid = decodeOid(type!.value);
      return `${OID_NAMES[oid] ?? oid}=${value!.value.toString("utf8")}`;
    })
    .join("\n");
}

function parseTime(t: Tlv): string {
  const s = t.value.toString("ascii");
  const full = t.tag === 0x17 ? `${Number(s.slice(0, 2)) < 50 ? "20" : "19"}${s}` : s; // UTCTime → 4-digit year
  return `${full.slice(0, 4)}-${full.slice(4, 6)}-${full.slice(6, 8)}T${full.slice(8, 10)}:${full.slice(10, 12)}:${full.slice(12, 14)}Z`;
}

export class X509Certificate {
  readonly issuer: string;
  readonly subject: string;
  readonly serialNumber: string;
  readonly validTo: string;
  readonly publicKey: { export(opts: { type: "spki"; format: "der" }): Buffer };

  constructor(der: Uint8Array) {
    const [tbs] = readChildren(readTlv(Buffer.from(der)).value);
    const fields = readChildren(tbs!.value);
    const f = fields[0]!.tag === 0xa0 ? fields.slice(1) : fields; // skip explicit version
    const [serial, , issuer, validity, subject, spki] = f;
    this.serialNumber = serial!.value.toString("hex").toUpperCase();
    this.issuer = formatName(issuer!);
    this.subject = formatName(subject!);
    this.validTo = parseTime(readChildren(validity!.value)[1]!);
    const spkiDer = Buffer.from(spki!.raw);
    this.publicKey = { export: () => spkiDer };
  }
}

export function randomUUID(): string {
  return globalThis.crypto.randomUUID();
}
