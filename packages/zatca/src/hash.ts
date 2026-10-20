import { createHash } from "node:crypto";
import type { Document, Element } from "@xmldom/xmldom";
import { canonicalize, parseXml } from "./c14n.ts";
import { NS } from "./namespaces.ts";

/** PIH of the first invoice on every EGS unit: base64(sha256-hex("0")). */
export const FIRST_PIH =
  "NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==";

/**
 * Removes what ZATCA excludes from the invoice hash — every ext:UBLExtensions, the
 * Invoice-level cac:Signature and the QR AdditionalDocumentReference — the same way the
 * SDK's XSLT does: only the elements go, the whitespace text around them stays.
 */
export function stripForHash(doc: Document): Document {
  const root = doc.documentElement!;
  const doomed: Element[] = [];

  for (const el of elements(root.getElementsByTagNameNS(NS.ext, "UBLExtensions"))) doomed.push(el);
  for (const el of children(root)) {
    if (el.namespaceURI === NS.cac && el.localName === "Signature") doomed.push(el);
  }
  for (const el of elements(root.getElementsByTagNameNS(NS.cac, "AdditionalDocumentReference"))) {
    const id = children(el).find((c) => c.namespaceURI === NS.cbc && c.localName === "ID");
    if (id && (id.textContent ?? "").trim() === "QR") doomed.push(el);
  }

  for (const el of doomed) el.parentNode?.removeChild(el);
  return doc;
}

/** Canonical bytes of the invoice as ZATCA hashes them. */
export function canonicalInvoice(xml: string): string {
  return canonicalize(stripForHash(parseXml(xml)));
}

/** Invoice hash: base64(SHA-256(C14N11(invoice minus signature/QR))). Also the next invoice's PIH. */
export function invoiceHash(xml: string): string {
  return createHash("sha256").update(canonicalInvoice(xml), "utf8").digest("base64");
}

export function children(el: Element): Element[] {
  const out: Element[] = [];
  for (let n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 1) out.push(n as Element);
  return out;
}

function elements(list: { length: number; item(i: number): Element | null }): Element[] {
  const out: Element[] = [];
  for (let i = 0; i < list.length; i++) out.push(list.item(i)!);
  return out;
}
