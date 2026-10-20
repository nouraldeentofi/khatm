import { AUDIENCE, DOCUMENT_TYPE, PAYMENT_MEANS } from "./codes.ts";
import { fmt, toPlain, type Dec } from "./decimal.ts";
import { invoiceSchema, type Address, type Buyer, type Invoice, type InvoiceInput, type Seller } from "./model.ts";
import { NS } from "./namespaces.ts";
import { computeTotals, type TaxKey, type Totals } from "./totals.ts";

type Node = { name: string; attrs?: Record<string, string>; text?: string; children?: Array<Node | false | undefined> };

const n = (name: string, content?: string | Array<Node | false | undefined>, attrs?: Record<string, string>): Node =>
  typeof content === "string" ? { name, text: content, attrs } : { name, children: content, attrs };

/** Builds the unsigned UBL 2.1 invoice. Sign it with `signInvoice` before it goes anywhere. */
export function buildInvoiceXml(input: InvoiceInput): { xml: string; invoice: Invoice; totals: Totals } {
  const invoice = invoiceSchema.parse(input);
  const totals = computeTotals(invoice);
  const cur = invoice.currency;
  const money = (name: string, v: Dec) => n(name, fmt(v), { currencyID: cur });
  const isStandard = invoice.audience === "standard";
  const supplyDate = invoice.supplyDate ?? (isStandard ? invoice.issueDate : undefined);

  const root = n(
    "Invoice",
    [
      n("cbc:ProfileID", "reporting:1.0"),
      n("cbc:ID", invoice.number),
      n("cbc:UUID", invoice.uuid),
      n("cbc:IssueDate", invoice.issueDate),
      n("cbc:IssueTime", invoice.issueTime),
      n("cbc:InvoiceTypeCode", DOCUMENT_TYPE[invoice.kind], { name: `${AUDIENCE[invoice.audience]}00000` }),
      invoice.note ? n("cbc:Note", invoice.note, { languageID: "ar" }) : undefined,
      n("cbc:DocumentCurrencyCode", cur),
      n("cbc:TaxCurrencyCode", "SAR"),
      invoice.billingReference
        ? n("cac:BillingReference", [n("cac:InvoiceDocumentReference", [n("cbc:ID", invoice.billingReference)])])
        : undefined,
      n("cac:AdditionalDocumentReference", [n("cbc:ID", "ICV"), n("cbc:UUID", String(invoice.icv))]),
      n("cac:AdditionalDocumentReference", [
        n("cbc:ID", "PIH"),
        n("cac:Attachment", [n("cbc:EmbeddedDocumentBinaryObject", invoice.pih, { mimeCode: "text/plain" })]),
      ]),
      n("cac:Signature", [
        n("cbc:ID", "urn:oasis:names:specification:ubl:signature:Invoice"),
        n("cbc:SignatureMethod", "urn:oasis:names:specification:ubl:dsig:enveloped:xades"),
      ]),
      n("cac:AccountingSupplierParty", [sellerParty(invoice.seller)]),
      n("cac:AccountingCustomerParty", invoice.buyer ? [buyerParty(invoice.buyer)] : []),
      supplyDate
        ? n("cac:Delivery", [
            n("cbc:ActualDeliveryDate", supplyDate),
            invoice.supplyEndDate ? n("cbc:LatestDeliveryDate", invoice.supplyEndDate) : undefined,
          ])
        : undefined,
      invoice.paymentMeans || invoice.noteReason
        ? n("cac:PaymentMeans", [
            n("cbc:PaymentMeansCode", PAYMENT_MEANS[invoice.paymentMeans ?? "not_defined"]),
            invoice.noteReason ? n("cbc:InstructionNote", invoice.noteReason) : undefined,
          ])
        : undefined,
      ...totals.allowances.map((a, i) =>
        n("cac:AllowanceCharge", [
          n("cbc:ChargeIndicator", "false"),
          n("cbc:AllowanceChargeReason", invoice.allowances[i]!.reason),
          money("cbc:Amount", a.amount),
          taxCategory("cac:TaxCategory", a.tax, false),
        ]),
      ),
      n("cac:TaxTotal", [money("cbc:TaxAmount", totals.vatTotal)]),
      n("cac:TaxTotal", [
        money("cbc:TaxAmount", totals.vatTotal),
        ...totals.subtotals.map((s) =>
          n("cac:TaxSubtotal", [
            money("cbc:TaxableAmount", s.taxable),
            money("cbc:TaxAmount", s.vat),
            taxCategory("cac:TaxCategory", s.tax, true),
          ]),
        ),
      ]),
      n("cac:LegalMonetaryTotal", [
        money("cbc:LineExtensionAmount", totals.lineExtension),
        money("cbc:TaxExclusiveAmount", totals.taxExclusive),
        money("cbc:TaxInclusiveAmount", totals.taxInclusive),
        money("cbc:AllowanceTotalAmount", totals.allowanceTotal),
        money("cbc:PrepaidAmount", totals.prepaid),
        money("cbc:PayableAmount", totals.payable),
      ]),
      ...totals.lines.map((l, i) => {
        const input = invoice.lines[i]!;
        return n("cac:InvoiceLine", [
          n("cbc:ID", String(i + 1)),
          n("cbc:InvoicedQuantity", toPlain(l.quantity), { unitCode: input.unitCode }),
          money("cbc:LineExtensionAmount", l.net),
          l.discount > 0n
            ? n("cac:AllowanceCharge", [
                n("cbc:ChargeIndicator", "false"),
                n("cbc:AllowanceChargeReason", input.discountReason),
                money("cbc:Amount", l.discount),
              ])
            : undefined,
          n("cac:TaxTotal", [money("cbc:TaxAmount", l.vat), money("cbc:RoundingAmount", l.total)]),
          n("cac:Item", [n("cbc:Name", input.name), taxCategory("cac:ClassifiedTaxCategory", l.tax, false)]),
          n("cac:Price", [n("cbc:PriceAmount", toPlain(l.unitPrice, 2), { currencyID: cur })]),
        ]);
      }),
    ],
    { xmlns: NS.invoice, "xmlns:cac": NS.cac, "xmlns:cbc": NS.cbc, "xmlns:ext": NS.ext },
  );

  return { xml: `<?xml version="1.0" encoding="UTF-8"?>\n${serialize(root, 0)}\n`, invoice, totals };
}

function taxCategory(name: string, t: TaxKey, withExemption: boolean): Node {
  return n(name, [
    n("cbc:ID", t.category),
    n("cbc:Percent", fmt(t.percent)),
    withExemption && t.exemptionCode ? n("cbc:TaxExemptionReasonCode", t.exemptionCode) : undefined,
    withExemption && t.exemptionReason ? n("cbc:TaxExemptionReason", t.exemptionReason) : undefined,
    n("cac:TaxScheme", [n("cbc:ID", "VAT")]),
  ]);
}

function postalAddress(a: Address): Node {
  return n("cac:PostalAddress", [
    n("cbc:StreetName", a.street),
    a.additionalStreet ? n("cbc:AdditionalStreetName", a.additionalStreet) : undefined,
    n("cbc:BuildingNumber", a.buildingNumber),
    a.additionalNumber ? n("cbc:PlotIdentification", a.additionalNumber) : undefined,
    n("cbc:CitySubdivisionName", a.district),
    n("cbc:CityName", a.city),
    n("cbc:PostalZone", a.postalCode),
    a.region ? n("cbc:CountrySubentity", a.region) : undefined,
    n("cac:Country", [n("cbc:IdentificationCode", a.country)]),
  ]);
}

function vatScheme(vatNumber: string): Node {
  return n("cac:PartyTaxScheme", [n("cbc:CompanyID", vatNumber), n("cac:TaxScheme", [n("cbc:ID", "VAT")])]);
}

function sellerParty(s: Seller): Node {
  return n("cac:Party", [
    n("cac:PartyIdentification", [n("cbc:ID", s.idValue, { schemeID: s.idScheme })]),
    postalAddress(s.address),
    vatScheme(s.vatNumber),
    n("cac:PartyLegalEntity", [n("cbc:RegistrationName", s.name)]),
  ]);
}

function buyerParty(b: Buyer): Node {
  return n("cac:Party", [
    b.idScheme && b.idValue
      ? n("cac:PartyIdentification", [n("cbc:ID", b.idValue, { schemeID: b.idScheme })])
      : undefined,
    b.address ? postalAddress(b.address) : undefined,
    b.vatNumber ? vatScheme(b.vatNumber) : undefined,
    n("cac:PartyLegalEntity", [n("cbc:RegistrationName", b.name)]),
  ]);
}

function serialize(node: Node, depth: number): string {
  const pad = "    ".repeat(depth);
  const attrs = Object.entries(node.attrs ?? {})
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => ` ${k}="${escapeAttr(v)}"`)
    .join("");
  if (node.text !== undefined) return `${pad}<${node.name}${attrs}>${escapeText(node.text)}</${node.name}>`;
  const kids = (node.children ?? []).filter((c): c is Node => Boolean(c));
  if (kids.length === 0) return `${pad}<${node.name}${attrs}/>`;
  return `${pad}<${node.name}${attrs}>\n${kids.map((k) => serialize(k, depth + 1)).join("\n")}\n${pad}</${node.name}>`;
}

const escapeText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttr = (s: string) => escapeText(s).replace(/"/g, "&quot;");
