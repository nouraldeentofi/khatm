import { EXEMPTION_REASONS, type ExemptionCode, type TaxCategory } from "./codes.ts";
import { ZERO, add, dec, mul, percentOf, round2, type Dec } from "./decimal.ts";
import type { Invoice } from "./model.ts";

export interface TaxKey {
  category: TaxCategory;
  percent: Dec;
  exemptionCode?: ExemptionCode;
  exemptionReason?: string;
}

export interface ComputedLine {
  quantity: Dec;
  unitPrice: Dec;
  discount: Dec;
  /** BT-131: quantity × price − discount, rounded to 2 places. */
  net: Dec;
  /** KSA-11 */
  vat: Dec;
  /** KSA-12 */
  total: Dec;
  tax: TaxKey;
}

export interface TaxSubtotal {
  tax: TaxKey;
  taxable: Dec;
  vat: Dec;
}

export interface Totals {
  lines: ComputedLine[];
  allowances: Array<{ amount: Dec; tax: TaxKey }>;
  subtotals: TaxSubtotal[];
  lineExtension: Dec;
  allowanceTotal: Dec;
  taxExclusive: Dec;
  vatTotal: Dec;
  taxInclusive: Dec;
  prepaid: Dec;
  payable: Dec;
}

function taxKey(item: {
  taxCategory: TaxCategory;
  taxPercent?: string | number;
  exemptionCode?: ExemptionCode;
  exemptionReason?: string;
}): TaxKey {
  const percent = item.taxPercent === undefined ? dec(item.taxCategory === "S" ? 15 : 0) : dec(item.taxPercent);
  const key: TaxKey = { category: item.taxCategory, percent };
  if (item.exemptionCode) {
    key.exemptionCode = item.exemptionCode;
    key.exemptionReason = item.exemptionReason || EXEMPTION_REASONS[item.exemptionCode].en;
  }
  return key;
}

const keyId = (k: TaxKey) => `${k.category}|${k.percent}|${k.exemptionCode ?? ""}|${k.exemptionReason ?? ""}`;
const sameRate = (a: TaxKey, b: TaxKey) => a.category === b.category && a.percent === b.percent;

/**
 * VAT per EN 16931 / ZATCA: each line's VAT is rounded on its own (KSA-11), while the
 * invoice VAT is computed per category on the summed taxable amount (BR-CO-17).
 */
export function computeTotals(inv: Invoice): Totals {
  const lines = inv.lines.map((l): ComputedLine => {
    const quantity = dec(l.quantity);
    const unitPrice = dec(l.unitPrice);
    const discount = dec(l.discount);
    const net = round2(mul(quantity, unitPrice) - discount);
    const tax = taxKey(l);
    const vat = round2(percentOf(net, tax.percent));
    return { quantity, unitPrice, discount, net, vat, total: net + vat, tax };
  });

  const groups = new Map<string, TaxSubtotal>();
  for (const l of lines) {
    const g = groups.get(keyId(l.tax)) ?? { tax: l.tax, taxable: ZERO, vat: ZERO };
    g.taxable += l.net;
    groups.set(keyId(l.tax), g);
  }

  const allowances = inv.allowances.map((a) => {
    const requested = taxKey(a);
    // An allowance reduces the taxable base of the line group with the same rate.
    const group = [...groups.values()].find((g) => sameRate(g.tax, requested));
    if (!group) throw new Error(`Allowance in category ${requested.category} has no matching lines`);
    const amount = round2(dec(a.amount));
    group.taxable -= amount;
    return { amount, tax: group.tax };
  });

  const subtotals = [...groups.values()];
  for (const g of subtotals) {
    if (g.taxable < 0n) throw new Error(`Allowances exceed the taxable amount for category ${g.tax.category}`);
    g.vat = round2(percentOf(g.taxable, g.tax.percent));
  }

  const lineExtension = add(...lines.map((l) => l.net));
  const allowanceTotal = add(...allowances.map((a) => a.amount));
  const taxExclusive = lineExtension - allowanceTotal;
  const vatTotal = add(...subtotals.map((g) => g.vat));
  const taxInclusive = taxExclusive + vatTotal;
  const prepaid = ZERO;

  return {
    lines,
    allowances,
    subtotals,
    lineExtension,
    allowanceTotal,
    taxExclusive,
    vatTotal,
    taxInclusive,
    prepaid,
    payable: taxInclusive - prepaid,
  };
}
