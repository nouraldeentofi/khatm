import { createPrivateKey, createPublicKey, createSign, generateKeyPairSync, type KeyObject } from "node:crypto";
import {
  bitString,
  contextConstructed,
  integer,
  octetString,
  oid,
  printableString,
  seq,
  set,
  utf8String,
} from "./der.ts";

export type Environment = "sandbox" | "simulation" | "production";

/** The certificate template ZATCA expects per environment — the commonest onboarding failure. */
export const CERTIFICATE_TEMPLATE: Record<Environment, string> = {
  sandbox: "TSTZATCA-Code-Signing",
  simulation: "PREZATCA-Code-Signing",
  production: "ZATCA-Code-Signing",
};

export interface CsrInput {
  environment: Environment;
  /** CN — unique name of the EGS unit, e.g. "EGS-<device id>". */
  commonName: string;
  /** SN — "1-<solution name>|2-<model/version>|3-<device serial (UUID)>". */
  serialNumber: string;
  /** UID — the taxpayer's 15-digit VAT number. */
  vatNumber: string;
  /** O — taxpayer name. */
  organizationName: string;
  /** OU — branch name (for VAT groups: the member's 10-digit TIN). */
  organizationUnit: string;
  /** title — 4 digits: standard, simplified, (reserved), (reserved). "1100" = both. */
  invoiceTypes: "1100" | "1000" | "0100";
  /** registeredAddress — branch location (short national address). */
  location: string;
  /** businessCategory — the taxpayer's industry. */
  industry: string;
}

export interface GeneratedCsr {
  /** PEM — what the ZATCA API takes, base64-encoded once more (see `csrForApi`). */
  pem: string;
  der: Buffer;
}

const OID = {
  C: "2.5.4.6",
  OU: "2.5.4.11",
  O: "2.5.4.10",
  CN: "2.5.4.3",
  SN: "2.5.4.4",
  UID: "0.9.2342.19200300.100.1.1",
  title: "2.5.4.12",
  registeredAddress: "2.5.4.26",
  businessCategory: "2.5.4.15",
  ecPublicKey: "1.2.840.10045.2.1",
  extensionRequest: "1.2.840.113549.1.9.14",
  certificateTemplateName: "1.3.6.1.4.1.311.20.2",
  subjectAltName: "2.5.29.17",
  ecdsaWithSha256: "1.2.840.10045.4.3.2",
};

/** Fresh secp256k1 key pair for one EGS unit. The private key never leaves the server. */
export function generateEgsKey(): { privateKeyPem: string; publicKey: KeyObject } {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "secp256k1" });
  return { privateKeyPem: privateKey.export({ type: "sec1", format: "pem" }).toString(), publicKey };
}

const rdn = (type: string, value: Buffer) => set(seq(oid(type), value));

/**
 * PKCS#10 request with the fields and encodings the official SDK produces
 * (subject C/OU/O/CN, template-name extension, SAN directoryName).
 */
export function createCsr(input: CsrInput, privateKeyPem: string | KeyObject): GeneratedCsr {
  validate(input);
  const key = typeof privateKeyPem === "string" ? createPrivateKey(privateKeyPem) : privateKeyPem;
  const spki = createPublicKey(key).export({ type: "spki", format: "der" });

  const subject = seq(
    rdn(OID.C, printableString("SA")),
    rdn(OID.OU, utf8String(input.organizationUnit)),
    rdn(OID.O, utf8String(input.organizationName)),
    rdn(OID.CN, utf8String(input.commonName)),
  );

  const san = seq(
    contextConstructed(
      4,
      seq(
        rdn(OID.SN, utf8String(input.serialNumber)),
        rdn(OID.UID, utf8String(input.vatNumber)),
        rdn(OID.title, utf8String(input.invoiceTypes)),
        rdn(OID.registeredAddress, utf8String(input.location)),
        rdn(OID.businessCategory, utf8String(input.industry)),
      ),
    ),
  );

  const extensions = seq(
    seq(oid(OID.certificateTemplateName), octetString(utf8String(CERTIFICATE_TEMPLATE[input.environment]))),
    seq(oid(OID.subjectAltName), octetString(san)),
  );

  const info = seq(
    integer(0),
    subject,
    spki,
    contextConstructed(0, seq(oid(OID.extensionRequest), set(extensions))),
  );

  const signature = createSign("sha256").update(info).sign(key);
  const der = seq(info, seq(oid(OID.ecdsaWithSha256)), bitString(signature));
  const pem = `-----BEGIN CERTIFICATE REQUEST-----\n${der.toString("base64").match(/.{1,64}/g)!.join("\n")}\n-----END CERTIFICATE REQUEST-----\n`;
  return { pem, der };
}

/** The `csr` field of POST /compliance: base64 of the whole PEM text. */
export function csrForApi(csr: GeneratedCsr): string {
  return Buffer.from(csr.pem, "utf8").toString("base64");
}

function validate(i: CsrInput): void {
  if (!/^3\d{13}3$/.test(i.vatNumber)) throw new Error("CSR: VAT number must be 15 digits starting and ending with 3");
  if (!/^1-[^|]+\|2-[^|]+\|3-[^|]+$/.test(i.serialNumber)) {
    throw new Error('CSR: serial number must look like "1-Solution|2-Version|3-DeviceSerial"');
  }
  for (const [k, v] of Object.entries(i)) {
    if (typeof v === "string" && v.trim() === "") throw new Error(`CSR: ${k} is empty`);
  }
}
