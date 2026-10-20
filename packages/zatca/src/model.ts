import { z } from "zod";
import {
  BUYER_ID_SCHEMES,
  DOCUMENT_TYPE,
  EXEMPTION_REASONS,
  PAYMENT_MEANS,
  SELLER_ID_SCHEMES,
  type ExemptionCode,
} from "./codes.ts";
import { dec, mul } from "./decimal.ts";

const amount = z.union([z.number(), z.string()]).refine((v) => {
  try {
    return dec(v) >= 0n;
  } catch {
    return false;
  }
}, "Must be a non-negative number with at most 6 decimals");

const vatNumber = z.string().regex(/^3\d{13}3$/, "VAT number must be 15 digits starting and ending with 3");
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD");
const time = z.string().regex(/^\d{2}:\d{2}:\d{2}$/, "Time must be HH:mm:ss");

const address = z.object({
  street: z.string().trim().min(1).max(1000),
  additionalStreet: z.string().trim().max(127).optional(),
  buildingNumber: z.string().trim().min(1),
  /** Additional number of the national address (PlotIdentification). */
  additionalNumber: z.string().trim().optional(),
  district: z.string().trim().min(1).max(127),
  city: z.string().trim().min(1).max(127),
  postalCode: z.string().trim().min(1),
  region: z.string().trim().optional(),
  country: z.string().length(2).default("SA"),
});
export type Address = z.infer<typeof address>;

export const sellerSchema = z.object({
  /** Legal name as in the commercial registration. */
  name: z.string().trim().min(1).max(1000),
  vatNumber,
  idScheme: z.enum(SELLER_ID_SCHEMES).default("CRN"),
  idValue: z.string().regex(/^[A-Za-z0-9]+$/, "Seller ID must be alphanumeric"),
  address: address.extend({
    buildingNumber: z.string().regex(/^\d{4}$/, "Building number must be 4 digits"),
    postalCode: z.string().regex(/^\d{5}$/, "Postal code must be 5 digits"),
    country: z.literal("SA").default("SA"),
  }),
});
export type Seller = z.infer<typeof sellerSchema>;
export type SellerInput = z.input<typeof sellerSchema>;

export const buyerSchema = z.object({
  name: z.string().trim().min(1).max(1000),
  vatNumber: vatNumber.optional(),
  idScheme: z.enum(BUYER_ID_SCHEMES).optional(),
  idValue: z.string().regex(/^[A-Za-z0-9]+$/, "Buyer ID must be alphanumeric").optional(),
  address: address.optional(),
});
export type Buyer = z.infer<typeof buyerSchema>;

const exemptionCode = z.enum(Object.keys(EXEMPTION_REASONS) as [ExemptionCode, ...ExemptionCode[]]);

const taxed = {
  taxCategory: z.enum(["S", "Z", "E", "O"]).default("S"),
  /** Defaults to 15 for S and 0 otherwise. */
  taxPercent: amount.optional(),
  exemptionCode: exemptionCode.optional(),
  /** Free-text reason, required for VATEX-SA-OOS. */
  exemptionReason: z.string().trim().max(1000).optional(),
};

export const lineSchema = z.object({
  name: z.string().trim().min(1).max(1000),
  quantity: amount,
  /** UN/ECE rec 20 unit code; PCE = piece. */
  unitCode: z.string().default("PCE"),
  unitPrice: amount,
  /** Total discount on the line (not per unit). */
  discount: amount.default(0),
  discountReason: z.string().trim().max(1000).default("discount"),
  ...taxed,
});
export type LineInput = z.input<typeof lineSchema>;

export const allowanceSchema = z.object({
  amount,
  reason: z.string().trim().min(1).max(1000).default("discount"),
  ...taxed,
});

export const invoiceSchema = z
  .object({
    kind: z.enum(Object.keys(DOCUMENT_TYPE) as ["invoice", "credit_note", "debit_note"]),
    audience: z.enum(["standard", "simplified"]),
    /** Human-facing sequential number (cbc:ID). */
    number: z.string().trim().min(1).max(127),
    uuid: z.uuid(),
    issueDate: date,
    /** Local (Riyadh) time. */
    issueTime: time,
    supplyDate: date.optional(),
    supplyEndDate: date.optional(),
    currency: z.literal("SAR").default("SAR"),
    icv: z.number().int().positive(),
    pih: z.string().regex(/^[A-Za-z0-9+/]+=*$/, "PIH must be base64"),
    seller: sellerSchema,
    buyer: buyerSchema.optional(),
    paymentMeans: z.enum(Object.keys(PAYMENT_MEANS) as [keyof typeof PAYMENT_MEANS]).optional(),
    /** Original invoice number — required for credit and debit notes. */
    billingReference: z.string().trim().min(1).max(5000).optional(),
    /** Reason for issuing a credit/debit note (KSA-10). */
    noteReason: z.string().trim().min(1).max(1000).optional(),
    note: z.string().trim().max(1000).optional(),
    lines: z.array(lineSchema).min(1),
    allowances: z.array(allowanceSchema).default([]),
  })
  .superRefine((inv, ctx) => {
    const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });

    if (inv.kind !== "invoice") {
      if (!inv.billingReference) issue(["billingReference"], "Credit/debit notes must reference the original invoice");
      if (!inv.noteReason) issue(["noteReason"], "Credit/debit notes must state the reason");
    }
    if (inv.supplyEndDate && (!inv.supplyDate || inv.supplyEndDate < inv.supplyDate)) {
      issue(["supplyEndDate"], "Supply end date needs a supply date on or before it");
    }

    if (inv.audience === "standard") {
      const b = inv.buyer;
      if (!b) issue(["buyer"], "Tax invoices need the buyer's details");
      else {
        if (!b.vatNumber && !(b.idScheme && b.idValue)) {
          issue(["buyer", "idValue"], "Buyer needs a VAT number or another ID (e.g. CR number)");
        }
        if (!b.address) issue(["buyer", "address"], "Tax invoices need the buyer's address");
        else if (b.address.country === "SA") {
          if (!/^\d{5}$/.test(b.address.postalCode)) issue(["buyer", "address", "postalCode"], "Postal code must be 5 digits");
        }
      }
    }

    const checkTax = (item: { taxCategory: string; taxPercent?: string | number; exemptionCode?: ExemptionCode; exemptionReason?: string }, path: (string | number)[]) => {
      const pct = item.taxPercent === undefined ? undefined : dec(item.taxPercent);
      if (item.taxCategory === "S") {
        if (pct !== undefined && pct <= 0n) issue([...path, "taxPercent"], "Standard-rated items need a positive VAT rate");
        if (item.exemptionCode) issue([...path, "exemptionCode"], "Standard-rated items have no exemption code");
        return;
      }
      if (pct !== undefined && pct !== 0n) issue([...path, "taxPercent"], `Category ${item.taxCategory} must have a 0% rate`);
      if (!item.exemptionCode) {
        issue([...path, "exemptionCode"], `Category ${item.taxCategory} needs an exemption reason code`);
        return;
      }
      if (EXEMPTION_REASONS[item.exemptionCode].category !== item.taxCategory) {
        issue([...path, "exemptionCode"], `${item.exemptionCode} does not apply to category ${item.taxCategory}`);
      }
      if (item.exemptionCode === "VATEX-SA-OOS" && !item.exemptionReason) {
        issue([...path, "exemptionReason"], "Out-of-scope supplies need a reason");
      }
      if ((item.exemptionCode === "VATEX-SA-EDU" || item.exemptionCode === "VATEX-SA-HEA") && inv.buyer?.idScheme !== "NAT") {
        issue(["buyer", "idScheme"], "Private education/healthcare to citizens needs the buyer's national ID (NAT)");
      }
    };
    inv.lines.forEach((l, i) => {
      checkTax(l, ["lines", i]);
      if (dec(l.discount) > mul(dec(l.quantity), dec(l.unitPrice))) {
        issue(["lines", i, "discount"], "Discount exceeds the line amount");
      }
    });
    inv.allowances.forEach((a, i) => checkTax(a, ["allowances", i]));
  });

export type InvoiceInput = z.input<typeof invoiceSchema>;
export type Invoice = z.output<typeof invoiceSchema>;
