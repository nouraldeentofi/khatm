import { randomUUID } from "node:crypto";
import { FIRST_PIH, type InvoiceInput } from "../../src/index.ts";

/** Matches the SDK test certificate (VAT 399999999900003). */
export const SELLER = {
  name: "شركة توريد التكنولوجيا بأقصى سرعة المحدودة | Maximum Speed Tech Supply LTD",
  vatNumber: "399999999900003",
  idScheme: "CRN",
  idValue: "1010010000",
  address: {
    street: "الامير سلطان | Prince Sultan",
    buildingNumber: "2322",
    additionalNumber: "1234",
    district: "المربع | Al-Murabba",
    city: "الرياض | Riyadh",
    postalCode: "23333",
  },
} as const;

export const BUYER = {
  name: "شركة نماذج فاتورة المحدودة | Fatoora Samples LTD",
  vatNumber: "399999999800003",
  address: {
    street: "صلاح الدين | Salah Al-Din",
    buildingNumber: "1111",
    district: "المروج | Al-Murooj",
    city: "الرياض | Riyadh",
    postalCode: "12222",
  },
} as const;

export function sampleInvoice(
  kind: InvoiceInput["kind"],
  audience: InvoiceInput["audience"],
  overrides: Partial<InvoiceInput> = {},
): InvoiceInput {
  const today = new Date(Date.now() + 3 * 3600_000).toISOString();
  return {
    kind,
    audience,
    number: `INV-${kind}-${audience}`,
    uuid: randomUUID(),
    issueDate: today.slice(0, 10),
    issueTime: today.slice(11, 19),
    icv: 1,
    pih: FIRST_PIH,
    seller: SELLER,
    buyer: audience === "standard" ? BUYER : undefined,
    paymentMeans: "cash",
    ...(kind === "invoice" ? {} : { billingReference: "INV-0001", noteReason: "Goods returned | إرجاع بضاعة" }),
    lines: [
      { name: "قلم رصاص | Pencil", quantity: 2, unitPrice: "2.00" },
      { name: "دفتر | Notebook", quantity: 3, unitPrice: "12.50", discount: "1.25" },
    ],
    ...overrides,
  };
}
