import { X509Certificate, createHash } from "node:crypto";
import { readChildren, readTlv } from "./der.ts";

export interface CertificateInfo {
  /** Base64 DER body, exactly as embedded in ds:X509Certificate. */
  base64: string;
  /** "CN=..., DC=extgazt, DC=gov, DC=local" — the form ZATCA expects in X509IssuerName. */
  issuerName: string;
  /** Decimal serial number. */
  serialNumber: string;
  /** base64(hex(sha256(base64 body))) — ZATCA's certificate digest. */
  hash: string;
  /** DER SubjectPublicKeyInfo — QR tag 8. */
  publicKeyDer: Buffer;
  /** DER ECDSA signature by ZATCA's CA over the certificate — QR tag 9. */
  signatureDer: Buffer;
  notAfter: Date;
  subject: string;
}

/** Accepts PEM, bare base64 DER, or the binarySecurityToken ZATCA returns (base64 of base64). */
export function parseCertificate(input: string): CertificateInfo {
  const base64 = normalizeCertificate(input);
  const der = Buffer.from(base64, "base64");
  const x509 = new X509Certificate(der);

  const [, , signatureValue] = readChildren(readTlv(der).value);
  if (!signatureValue || signatureValue.tag !== 0x03) throw new Error("Certificate has no signature");

  return {
    base64,
    issuerName: x509.issuer.split("\n").reverse().join(", "),
    serialNumber: BigInt(`0x${x509.serialNumber}`).toString(10),
    hash: Buffer.from(createHash("sha256").update(base64, "utf8").digest("hex")).toString("base64"),
    publicKeyDer: x509.publicKey.export({ type: "spki", format: "der" }),
    signatureDer: signatureValue.value.subarray(1), // drop the "unused bits" byte
    notAfter: new Date(x509.validTo),
    subject: x509.subject,
  };
}

export function normalizeCertificate(input: string): string {
  let s = input.replace(/-----(BEGIN|END) CERTIFICATE-----/g, "").replace(/\s+/g, "");
  // binarySecurityToken is base64(base64(DER)); a DER certificate always starts with "MII".
  if (!s.startsWith("MI")) s = Buffer.from(s, "base64").toString("utf8").replace(/\s+/g, "");
  if (!s.startsWith("MI")) throw new Error("Unrecognised certificate encoding");
  return s;
}
