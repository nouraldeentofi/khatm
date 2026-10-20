import { describe, expect, it } from "vitest";
import { buildInvoiceXml, computeTotals, fmt, invoiceSchema, signInvoice, type InvoiceInput } from "../src/index.ts";
import { sampleInvoice } from "./fixtures/invoices.ts";
import { sdkTestCredentials } from "./helpers.ts";
import { sdkAvailable, sdkValidate } from "./sdk.ts";

const creds = sdkTestCredentials();

describe("computeTotals", () => {
  it("rounds line VAT per line and invoice VAT per category", () => {
    const totals = computeTotals(invoiceSchema.parse(sampleInvoice("invoice", "standard")));
    // 2 × 2.00 = 4.00 ; 3 × 12.50 − 1.25 = 36.25
    expect(totals.lines.map((l) => [fmt(l.net), fmt(l.vat), fmt(l.total)])).toEqual([
      ["4.00", "0.60", "4.60"],
      ["36.25", "5.44", "41.69"],
    ]);
    expect(fmt(totals.taxExclusive)).toBe("40.25");
    expect(fmt(totals.vatTotal)).toBe("6.04"); // 40.25 × 15% = 6.0375
    expect(fmt(totals.payable)).toBe("46.29");
  });

  it("applies document-level allowances to the matching category", () => {
    const inv = sampleInvoice("invoice", "simplified", {
      allowances: [{ amount: "10", reason: "خصم عميل دائم" }],
    });
    const totals = computeTotals(invoiceSchema.parse(inv));
    expect(fmt(totals.allowanceTotal)).toBe("10.00");
    expect(fmt(totals.taxExclusive)).toBe("30.25");
    expect(fmt(totals.vatTotal)).toBe("4.54");
  });
});

describe("invoiceSchema", () => {
  const issues = (inv: InvoiceInput) =>
    invoiceSchema.safeParse(inv).error?.issues.map((i) => i.path.join(".")) ?? [];

  it("requires the original invoice and a reason on credit notes", () => {
    const { billingReference: _b, noteReason: _r, ...rest } = sampleInvoice("credit_note", "standard");
    expect(issues(rest as InvoiceInput)).toEqual(expect.arrayContaining(["billingReference", "noteReason"]));
  });

  it("requires buyer VAT or another ID and an address on tax invoices", () => {
    expect(issues(sampleInvoice("invoice", "standard", { buyer: { name: "x" } }))).toEqual(
      expect.arrayContaining(["buyer.idValue", "buyer.address"]),
    );
  });

  it("rejects exemption codes from the wrong category", () => {
    const inv = sampleInvoice("invoice", "standard", {
      lines: [{ name: "x", quantity: 1, unitPrice: 1, taxCategory: "E", exemptionCode: "VATEX-SA-32" }],
    });
    expect(issues(inv)).toContain("lines.0.exemptionCode");
  });

  it("validates seller VAT format", () => {
    const inv = sampleInvoice("invoice", "simplified");
    expect(issues({ ...inv, seller: { ...inv.seller, vatNumber: "123" } })).toContain("seller.vatNumber");
  });
});

const COMPLIANCE_SET: Array<[InvoiceInput["kind"], InvoiceInput["audience"]]> = [
  ["invoice", "standard"],
  ["credit_note", "standard"],
  ["debit_note", "standard"],
  ["invoice", "simplified"],
  ["credit_note", "simplified"],
  ["debit_note", "simplified"],
];

const EXTRA_CASES: Array<[string, InvoiceInput]> = [
  [
    "mixed S/Z/E/O categories",
    sampleInvoice("invoice", "standard", {
      lines: [
        { name: "خدمة", quantity: 1, unitPrice: "100" },
        { name: "تصدير", quantity: 1, unitPrice: "50", taxCategory: "Z", exemptionCode: "VATEX-SA-32" },
        { name: "تأمين", quantity: 1, unitPrice: "70", taxCategory: "E", exemptionCode: "VATEX-SA-29-7" },
        { name: "رسوم حكومية", quantity: 1, unitPrice: "30", taxCategory: "O", exemptionCode: "VATEX-SA-OOS", exemptionReason: "Government fees collected on behalf" },
      ],
    }),
  ],
  [
    "document allowance + fractional quantity",
    sampleInvoice("invoice", "simplified", {
      lines: [{ name: "قماش (متر)", quantity: "2.75", unitCode: "MTR", unitPrice: "18.40" }],
      allowances: [{ amount: "5.06", reason: "خصم" }],
    }),
  ],
  [
    "buyer identified by CR number instead of VAT",
    sampleInvoice("invoice", "standard", {
      buyer: {
        name: "مؤسسة نجد للتوريدات",
        idScheme: "CRN",
        idValue: "1010101010",
        address: { street: "طريق الملك فهد", buildingNumber: "7788", district: "العليا", city: "الرياض", postalCode: "12211" },
      },
    }),
  ],
];

describe.runIf(sdkAvailable)("official SDK accepts generated invoices", () => {
  for (const [kind, audience] of COMPLIANCE_SET) {
    it(`${audience} ${kind}`, async () => {
      const { xml } = buildInvoiceXml(sampleInvoice(kind, audience));
      const result = await sdkValidate(signInvoice(xml, creds).xml, `${audience}-${kind}.xml`);
      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([]);
      expect(result.passed).toBe(true);
    }, 60_000);
  }

  for (const [label, input] of EXTRA_CASES) {
    it(label, async () => {
      const { xml } = buildInvoiceXml(input);
      const result = await sdkValidate(signInvoice(xml, creds).xml);
      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([]);
      expect(result.passed).toBe(true);
    }, 60_000);
  }
});
