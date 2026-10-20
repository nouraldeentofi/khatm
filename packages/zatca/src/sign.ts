import { createHash, createPrivateKey, createSign, type KeyObject } from "node:crypto";
import type { Element } from "@xmldom/xmldom";
import { parseCertificate, type CertificateInfo } from "./cert.ts";
import { parseXml } from "./c14n.ts";
import { children, invoiceHash } from "./hash.ts";
import { NS } from "./namespaces.ts";
import { buildQr } from "./qr.ts";

export interface SigningCredentials {
  /** EGS certificate: PEM, base64 DER, or ZATCA's binarySecurityToken. */
  certificate: string;
  /** secp256k1 private key (PEM or KeyObject). */
  privateKey: string | KeyObject;
}

export interface SignedInvoice {
  xml: string;
  /** Invoice hash — submit it with the invoice and store it as the device's next PIH. */
  hash: string;
  qr: string;
  signature: string;
}

/**
 * Signs a UBL invoice the way ZATCA validates it (XAdES-BES shaped, but non-standard):
 *  - SignatureValue = ECDSA-SHA256 over the raw invoice-hash bytes, not over SignedInfo;
 *  - digests of the certificate and SignedProperties are base64 of the *hex* SHA-256;
 *  - SignedProperties is hashed as Java serializes it: xmlns:xades on the element,
 *    xmlns:ds on every ds:* element, empty elements self-closed.
 * Inserted elements carry no whitespace outside themselves, so the hash is unchanged.
 */
export function signInvoice(
  unsignedXml: string,
  credentials: SigningCredentials,
  options: { signingTime?: Date } = {},
): SignedInvoice {
  const xml = unsignedXml.replace(/<ext:UBLExtensions>[\s\S]*<\/ext:UBLExtensions>/, "");
  if (!xml.includes("<cac:Signature>")) throw new Error("Invoice is missing cac:Signature");

  const cert = parseCertificate(credentials.certificate);
  const key =
    typeof credentials.privateKey === "string" ? createPrivateKey(credentials.privateKey) : credentials.privateKey;

  const hash = invoiceHash(xml);
  const signature = createSign("sha256").update(Buffer.from(hash, "base64")).sign(key).toString("base64");

  const signingTime = formatRiyadhTime(options.signingTime ?? new Date());
  const signedPropsHash = hexDigestBase64(signedProperties(cert, signingTime, true));

  const qr = buildQr({ ...qrFieldsFrom(xml), invoiceHash: hash, signature, publicKeyDer: cert.publicKeyDer,
    certificateSignatureDer: isSimplified(xml) ? cert.signatureDer : undefined });

  const extensions = ublExtensions({ hash, signedPropsHash, signature, cert, signingTime });
  let signed = xml.replace(/(<Invoice\b[^>]*>)/, `$1${extensions}`);
  signed = setQr(signed, qr);

  const check = invoiceHash(signed);
  if (check !== hash) throw new Error(`Signing changed the invoice hash (${hash} → ${check})`);
  return { xml: signed, hash, qr, signature };
}

function setQr(xml: string, qr: string): string {
  const existing = /(<cac:AdditionalDocumentReference>\s*<cbc:ID>QR<\/cbc:ID>[\s\S]*?<cbc:EmbeddedDocumentBinaryObject[^>]*>)[^<]*(<\/cbc:EmbeddedDocumentBinaryObject>)/;
  if (existing.test(xml)) return xml.replace(existing, `$1${qr}$2`);
  const block =
    `<cac:AdditionalDocumentReference><cbc:ID>QR</cbc:ID><cac:Attachment>` +
    `<cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${qr}</cbc:EmbeddedDocumentBinaryObject>` +
    `</cac:Attachment></cac:AdditionalDocumentReference>`;
  return xml.replace("<cac:Signature>", `${block}<cac:Signature>`);
}

function qrFieldsFrom(xml: string) {
  const root = parseXml(xml).documentElement!;
  const supplierParty = child(child(root, NS.cac, "AccountingSupplierParty"), NS.cac, "Party");
  const taxCurrency = text(child(root, NS.cbc, "TaxCurrencyCode")) || "SAR";
  const taxTotal =
    children(root).find(
      (el) =>
        el.localName === "TaxTotal" &&
        child(el, NS.cbc, "TaxAmount").getAttribute("currencyID") === taxCurrency,
    ) ?? child(root, NS.cac, "TaxTotal");

  return {
    sellerName: text(child(child(supplierParty, NS.cac, "PartyLegalEntity"), NS.cbc, "RegistrationName")),
    vatNumber: text(child(child(supplierParty, NS.cac, "PartyTaxScheme"), NS.cbc, "CompanyID")),
    timestamp: `${text(child(root, NS.cbc, "IssueDate"))}T${text(child(root, NS.cbc, "IssueTime"))}`,
    // Tag 4 is the amount due (BT-115), not BT-112: they differ once prepayments or rounding exist.
    totalWithVat: text(child(child(root, NS.cac, "LegalMonetaryTotal"), NS.cbc, "PayableAmount")),
    vatTotal: text(child(taxTotal, NS.cbc, "TaxAmount")),
  };
}

function isSimplified(xml: string): boolean {
  const m = xml.match(/<cbc:InvoiceTypeCode name="(\d{2})/);
  return m?.[1] === "02";
}

function child(el: Element, ns: string, local: string): Element {
  const found = children(el).find((c) => c.namespaceURI === ns && c.localName === local);
  if (!found) throw new Error(`Missing ${local} under ${el.localName}`);
  return found;
}

function text(el: Element): string {
  return (el.textContent ?? "").trim();
}

function hexDigestBase64(s: string): string {
  return Buffer.from(createHash("sha256").update(s, "utf8").digest("hex")).toString("base64");
}

/** "YYYY-MM-DDTHH:mm:ss" in Riyadh time (UTC+3, no DST). */
export function formatRiyadhTime(d: Date): string {
  return new Date(d.getTime() + 3 * 3600_000).toISOString().slice(0, 19);
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const DS = ` xmlns:ds="${NS.ds}"`;
const SHA256 = "http://www.w3.org/2001/04/xmlenc#sha256";

function signedProperties(cert: CertificateInfo, signingTime: string, forHashing: boolean): string {
  const ds = forHashing ? DS : "";
  const xades = forHashing ? ` xmlns:xades="${NS.xades}"` : "";
  const i = (n: number) => " ".repeat(n);
  return [
    `<xades:SignedProperties${xades} Id="xadesSignedProperties">`,
    `${i(36)}<xades:SignedSignatureProperties>`,
    `${i(40)}<xades:SigningTime>${signingTime}</xades:SigningTime>`,
    `${i(40)}<xades:SigningCertificate>`,
    `${i(44)}<xades:Cert>`,
    `${i(48)}<xades:CertDigest>`,
    `${i(52)}<ds:DigestMethod${ds} Algorithm="${SHA256}"/>`,
    `${i(52)}<ds:DigestValue${ds}>${cert.hash}</ds:DigestValue>`,
    `${i(48)}</xades:CertDigest>`,
    `${i(48)}<xades:IssuerSerial>`,
    `${i(52)}<ds:X509IssuerName${ds}>${esc(cert.issuerName)}</ds:X509IssuerName>`,
    `${i(52)}<ds:X509SerialNumber${ds}>${cert.serialNumber}</ds:X509SerialNumber>`,
    `${i(48)}</xades:IssuerSerial>`,
    `${i(44)}</xades:Cert>`,
    `${i(40)}</xades:SigningCertificate>`,
    `${i(36)}</xades:SignedSignatureProperties>`,
    `${i(32)}</xades:SignedProperties>`,
  ].join("\n");
}

function ublExtensions(p: {
  hash: string;
  signedPropsHash: string;
  signature: string;
  cert: CertificateInfo;
  signingTime: string;
}): string {
  const i = (n: number) => " ".repeat(n);
  const xpath = (expr: string) =>
    `${i(36)}<ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116">\n` +
    `${i(40)}<ds:XPath>${expr}</ds:XPath>\n` +
    `${i(36)}</ds:Transform>`;
  return [
    `<ext:UBLExtensions>`,
    `${i(4)}<ext:UBLExtension>`,
    `${i(8)}<ext:ExtensionURI>urn:oasis:names:specification:ubl:dsig:enveloped:xades</ext:ExtensionURI>`,
    `${i(8)}<ext:ExtensionContent>`,
    `${i(12)}<sig:UBLDocumentSignatures xmlns:sig="${NS.sig}" xmlns:sac="${NS.sac}" xmlns:sbc="${NS.sbc}">`,
    `${i(16)}<sac:SignatureInformation>`,
    `${i(20)}<cbc:ID>urn:oasis:names:specification:ubl:signature:1</cbc:ID>`,
    `${i(20)}<sbc:ReferencedSignatureID>urn:oasis:names:specification:ubl:signature:Invoice</sbc:ReferencedSignatureID>`,
    `${i(20)}<ds:Signature${DS} Id="signature">`,
    `${i(24)}<ds:SignedInfo>`,
    `${i(28)}<ds:CanonicalizationMethod Algorithm="http://www.w3.org/2006/12/xml-c14n11"/>`,
    `${i(28)}<ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256"/>`,
    `${i(28)}<ds:Reference Id="invoiceSignedData" URI="">`,
    `${i(32)}<ds:Transforms>`,
    xpath("not(//ancestor-or-self::ext:UBLExtensions)"),
    xpath("not(//ancestor-or-self::cac:Signature)"),
    xpath("not(//ancestor-or-self::cac:AdditionalDocumentReference[cbc:ID='QR'])"),
    `${i(36)}<ds:Transform Algorithm="http://www.w3.org/2006/12/xml-c14n11"/>`,
    `${i(32)}</ds:Transforms>`,
    `${i(32)}<ds:DigestMethod Algorithm="${SHA256}"/>`,
    `${i(32)}<ds:DigestValue>${p.hash}</ds:DigestValue>`,
    `${i(28)}</ds:Reference>`,
    `${i(28)}<ds:Reference Type="http://www.w3.org/2000/09/xmldsig#SignatureProperties" URI="#xadesSignedProperties">`,
    `${i(32)}<ds:DigestMethod Algorithm="${SHA256}"/>`,
    `${i(32)}<ds:DigestValue>${p.signedPropsHash}</ds:DigestValue>`,
    `${i(28)}</ds:Reference>`,
    `${i(24)}</ds:SignedInfo>`,
    `${i(24)}<ds:SignatureValue>${p.signature}</ds:SignatureValue>`,
    `${i(24)}<ds:KeyInfo>`,
    `${i(28)}<ds:X509Data>`,
    `${i(32)}<ds:X509Certificate>${p.cert.base64}</ds:X509Certificate>`,
    `${i(28)}</ds:X509Data>`,
    `${i(24)}</ds:KeyInfo>`,
    `${i(24)}<ds:Object>`,
    `${i(28)}<xades:QualifyingProperties xmlns:xades="${NS.xades}" Target="signature">`,
    `${i(32)}${signedProperties(p.cert, p.signingTime, false)}`,
    `${i(28)}</xades:QualifyingProperties>`,
    `${i(24)}</ds:Object>`,
    `${i(20)}</ds:Signature>`,
    `${i(16)}</sac:SignatureInformation>`,
    `${i(12)}</sig:UBLDocumentSignatures>`,
    `${i(8)}</ext:ExtensionContent>`,
    `${i(4)}</ext:UBLExtension>`,
    `</ext:UBLExtensions>`,
  ].join("\n");
}
