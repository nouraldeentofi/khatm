// The demo's link to @khatm/zatca. Imports the modules on the signing path directly
// (not the package index, which also pulls in CSR generation and the HTTP client).
import { EXEMPTION_REASONS, type ExemptionCode } from "../../../packages/zatca/src/codes.ts";
import { fmt, type Dec } from "../../../packages/zatca/src/decimal.ts";
import { FIRST_PIH } from "../../../packages/zatca/src/hash.ts";
import { invoiceSchema, type InvoiceInput } from "../../../packages/zatca/src/model.ts";
import { decodeQr } from "../../../packages/zatca/src/qr.ts";
import { formatRiyadhTime, signInvoice } from "../../../packages/zatca/src/sign.ts";
import { computeTotals, type Totals } from "../../../packages/zatca/src/totals.ts";
import { buildInvoiceXml } from "../../../packages/zatca/src/xml.ts";

export { EXEMPTION_REASONS, FIRST_PIH, decodeQr, fmt, type Dec, type ExemptionCode, type InvoiceInput, type Totals };

/**
 * ZATCA's public test certificate and key from the official SDK (Data/Certificates).
 * They exist so anyone can produce signatures the SDK will verify; nothing signed with
 * them is a valid tax document.
 */
const TEST_CERTIFICATE =
  "MIID3jCCA4SgAwIBAgITEQAAOAPF90Ajs/xcXwABAAA4AzAKBggqhkjOPQQDAjBiMRUwEwYKCZImiZPyLGQBGRYFbG9jYWwxEzARBgoJkiaJk/IsZAEZFgNnb3YxFzAVBgoJkiaJk/IsZAEZFgdleHRnYXp0MRswGQYDVQQDExJQUlpFSU5WT0lDRVNDQTQtQ0EwHhcNMjQwMTExMDkxOTMwWhcNMjkwMTA5MDkxOTMwWjB1MQswCQYDVQQGEwJTQTEmMCQGA1UEChMdTWF4aW11bSBTcGVlZCBUZWNoIFN1cHBseSBMVEQxFjAUBgNVBAsTDVJpeWFkaCBCcmFuY2gxJjAkBgNVBAMTHVRTVC04ODY0MzExNDUtMzk5OTk5OTk5OTAwMDAzMFYwEAYHKoZIzj0CAQYFK4EEAAoDQgAEoWCKa0Sa9FIErTOv0uAkC1VIKXxU9nPpx2vlf4yhMejy8c02XJblDq7tPydo8mq0ahOMmNo8gwni7Xt1KT9UeKOCAgcwggIDMIGtBgNVHREEgaUwgaKkgZ8wgZwxOzA5BgNVBAQMMjEtVFNUfDItVFNUfDMtZWQyMmYxZDgtZTZhMi0xMTE4LTliNTgtZDlhOGYxMWU0NDVmMR8wHQYKCZImiZPyLGQBAQwPMzk5OTk5OTk5OTAwMDAzMQ0wCwYDVQQMDAQxMTAwMREwDwYDVQQaDAhSUlJEMjkyOTEaMBgGA1UEDwwRU3VwcGx5IGFjdGl2aXRpZXMwHQYDVR0OBBYEFEX+YvmmtnYoDf9BGbKo7ocTKYK1MB8GA1UdIwQYMBaAFJvKqqLtmqwskIFzVvpP2PxT+9NnMHsGCCsGAQUFBwEBBG8wbTBrBggrBgEFBQcwAoZfaHR0cDovL2FpYTQuemF0Y2EuZ292LnNhL0NlcnRFbnJvbGwvUFJaRUludm9pY2VTQ0E0LmV4dGdhenQuZ292LmxvY2FsX1BSWkVJTlZPSUNFU0NBNC1DQSgxKS5jcnQwDgYDVR0PAQH/BAQDAgeAMDwGCSsGAQQBgjcVBwQvMC0GJSsGAQQBgjcVCIGGqB2E0PsShu2dJIfO+xnTwFVmh/qlZYXZhD4CAWQCARIwHQYDVR0lBBYwFAYIKwYBBQUHAwMGCCsGAQUFBwMCMCcGCSsGAQQBgjcVCgQaMBgwCgYIKwYBBQUHAwMwCgYIKwYBBQUHAwIwCgYIKoZIzj0EAwIDSAAwRQIhALE/ichmnWXCUKUbca3yci8oqwaLvFdHVjQrveI9uqAbAiA9hC4M8jgMBADPSzmd2uiPJA6gKR3LE03U75eqbC/rXA==";
const TEST_PRIVATE_KEY =
  "-----BEGIN EC PRIVATE KEY-----\nMHQCAQEEIL14JV+5nr/sE8Sppaf2IySovrhVBtt8+yz+g4NRKyz8oAcGBSuBBAAK\noUQDQgAEoWCKa0Sa9FIErTOv0uAkC1VIKXxU9nPpx2vlf4yhMejy8c02XJblDq7t\nPydo8mq0ahOMmNo8gwni7Xt1KT9UeA==\n-----END EC PRIVATE KEY-----\n";

/** The test certificate belongs to this VAT number; the seller must carry it. */
export const TEST_VAT_NUMBER = "399999999900003";

export interface IssuedDoc {
  number: string;
  kind: InvoiceInput["kind"];
  audience: InvoiceInput["audience"];
  uuid: string;
  icv: number;
  pih: string;
  hash: string;
  qr: string;
  signature: string;
  xml: string;
  issueDate: string;
  issueTime: string;
  input: InvoiceInput;
  totals: {
    lineExtension: string;
    allowanceTotal: string;
    taxExclusive: string;
    vatTotal: string;
    taxInclusive: string;
    payable: string;
    lines: Array<{ net: string; vat: string; total: string; percent: string }>;
    subtotals: Array<{ category: string; percent: string; taxable: string; vat: string; reason?: string }>;
  };
}

export type Draft = Omit<InvoiceInput, "number" | "uuid" | "issueDate" | "issueTime" | "icv" | "pih">;

export function previewTotals(draft: Draft) {
  const parsed = invoiceSchema.safeParse({
    ...draft,
    number: "PREVIEW",
    uuid: globalThis.crypto.randomUUID(),
    issueDate: "2026-01-01",
    issueTime: "00:00:00",
    icv: 1,
    pih: FIRST_PIH,
  });
  if (!parsed.success) return { issues: parsed.error.issues, totals: undefined };
  try {
    return { issues: [], totals: snapshot(computeTotals(parsed.data)) };
  } catch (err) {
    return { issues: [{ code: "custom", path: [], message: String((err as Error).message) }], totals: undefined };
  }
}

/** Builds, hashes and signs the next document on the demo device's chain. */
export function issue(draft: Draft, chain: { icv: number; lastHash: string; number: string }, at = new Date()): IssuedDoc {
  const now = formatRiyadhTime(at);
  const input: InvoiceInput = {
    ...draft,
    number: chain.number,
    uuid: globalThis.crypto.randomUUID(),
    issueDate: now.slice(0, 10),
    issueTime: now.slice(11, 19),
    icv: chain.icv,
    pih: chain.lastHash,
  };
  const { xml, totals } = buildInvoiceXml(input);
  const signed = signInvoice(xml, { certificate: TEST_CERTIFICATE, privateKey: TEST_PRIVATE_KEY });
  return {
    number: input.number,
    kind: input.kind,
    audience: input.audience,
    uuid: input.uuid,
    icv: input.icv,
    pih: input.pih,
    hash: signed.hash,
    qr: signed.qr,
    signature: signed.signature,
    xml: signed.xml,
    issueDate: input.issueDate,
    issueTime: input.issueTime,
    input,
    totals: snapshot(totals),
  };
}

function snapshot(t: Totals): IssuedDoc["totals"] {
  return {
    lineExtension: fmt(t.lineExtension),
    allowanceTotal: fmt(t.allowanceTotal),
    taxExclusive: fmt(t.taxExclusive),
    vatTotal: fmt(t.vatTotal),
    taxInclusive: fmt(t.taxInclusive),
    payable: fmt(t.payable),
    lines: t.lines.map((l) => ({ net: fmt(l.net), vat: fmt(l.vat), total: fmt(l.total), percent: fmt(l.tax.percent) })),
    subtotals: t.subtotals.map((s) => ({
      category: s.tax.category,
      percent: fmt(s.tax.percent),
      taxable: fmt(s.taxable),
      vat: fmt(s.vat),
      reason: s.tax.exemptionCode,
    })),
  };
}
