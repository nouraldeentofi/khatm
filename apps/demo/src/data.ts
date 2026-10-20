import { FIRST_PIH, TEST_VAT_NUMBER, issue, type Draft, type ExemptionCode, type IssuedDoc } from "./engine.ts";

/** The demo establishment. Its VAT number is the one on ZATCA's test certificate. */
export const SELLER = {
  name: "مؤسسة الواحة التجارية",
  vatNumber: TEST_VAT_NUMBER,
  idScheme: "CRN" as const,
  idValue: "1010010000",
  address: {
    street: "طريق الأمير سلطان",
    buildingNumber: "2322",
    additionalNumber: "8228",
    district: "المربع",
    city: "الرياض",
    postalCode: "23333",
  },
};

export interface Customer {
  id: string;
  name: string;
  vatNumber?: string;
  crNumber?: string;
  street: string;
  building: string;
  district: string;
  city: string;
  postal: string;
}

export const TAX_OPTIONS = [
  { id: "S15", label: "15%", category: "S" },
  { id: "Z32", label: "0% تصدير سلع", category: "Z", code: "VATEX-SA-32" },
  { id: "Z33", label: "0% تصدير خدمات", category: "Z", code: "VATEX-SA-33" },
  { id: "Z35", label: "0% أدوية ومعدات طبية", category: "Z", code: "VATEX-SA-35" },
  { id: "E29", label: "معفى: خدمات مالية", category: "E", code: "VATEX-SA-29" },
  { id: "E30", label: "معفى: عقار سكني", category: "E", code: "VATEX-SA-30" },
  { id: "O", label: "خارج نطاق الضريبة", category: "O", code: "VATEX-SA-OOS" },
] as const;
export type TaxId = (typeof TAX_OPTIONS)[number]["id"];

export const PAYMENT_OPTIONS = [
  ["bank_transfer", "تحويل بنكي"],
  ["cash", "نقداً"],
  ["card", "مدى أو بطاقة ائتمانية"],
  ["credit", "آجل"],
] as const;
export type Payment = (typeof PAYMENT_OPTIONS)[number][0];

export interface LineRow {
  key: number;
  name: string;
  quantity: string;
  unitPrice: string;
  discount: string;
  tax: TaxId;
}

export function taxFields(id: TaxId) {
  const opt = TAX_OPTIONS.find((o) => o.id === id)!;
  if (opt.category === "S") return { taxCategory: "S" as const };
  return {
    taxCategory: opt.category,
    exemptionCode: opt.code as ExemptionCode,
    ...(opt.code === "VATEX-SA-OOS" ? { exemptionReason: "Not subject to VAT" } : {}),
  };
}

export function taxIdOf(line: { taxCategory?: string; exemptionCode?: string }): TaxId {
  return (TAX_OPTIONS.find((o) => o.category === (line.taxCategory ?? "S") && ("code" in o ? o.code === line.exemptionCode : true))?.id ?? "S15") as TaxId;
}

export function buyerOf(c: Customer) {
  return {
    name: c.name,
    ...(c.vatNumber ? { vatNumber: c.vatNumber } : c.crNumber ? { idScheme: "CRN" as const, idValue: c.crNumber } : {}),
    address: { street: c.street, buildingNumber: c.building, district: c.district, city: c.city, postalCode: c.postal },
  };
}

export const SEED_CUSTOMERS: Customer[] = [
  { id: "c1", name: "مؤسسة نجد للتوريدات", vatNumber: "399999999800003", street: "طريق الملك فهد", building: "7788", district: "العليا", city: "الرياض", postal: "12211" },
  { id: "c2", name: "شركة الخليج للمقاولات", vatNumber: "311111111100003", street: "شارع الأمير محمد بن فهد", building: "3120", district: "الشاطئ", city: "الدمام", postal: "32413" },
  { id: "c3", name: "مطاعم السدرة", crNumber: "1010123456", street: "طريق التخصصي", building: "4410", district: "المعذر", city: "الرياض", postal: "12333" },
];

export interface Store {
  docs: IssuedDoc[];
  customers: Customer[];
  /** Which customer each document was issued to ("" for walk-in buyers). */
  docCustomer: Record<string, string>;
}

/** Appends a document to the demo device's chain. */
export function append(store: Store, draft: Draft, customerId: string, at?: Date): Store {
  const last = store.docs[store.docs.length - 1];
  const icv = (last?.icv ?? 0) + 1;
  const doc = issue(draft, { icv, lastHash: last?.hash ?? FIRST_PIH, number: `INV-${String(icv).padStart(5, "0")}` }, at);
  return { ...store, docs: [...store.docs, doc], docCustomer: { ...store.docCustomer, [doc.uuid]: customerId } };
}

const line = (name: string, quantity: string, unitPrice: string, discount = "0") => ({ name, quantity, unitPrice, discount });
const base = { seller: SELLER, paymentMeans: "bank_transfer" as const };

/** A week of plausible activity, so the first screen shows what the product does. */
export function seedStore(now = new Date()): Store {
  const daysAgo = (d: number, h: number) => new Date(now.getTime() - d * 86_400_000 - h * 3_600_000);
  let s: Store = { docs: [], customers: SEED_CUSTOMERS, docCustomer: {} };
  const [najd, gulf, sidra] = SEED_CUSTOMERS as [Customer, Customer, Customer];
  s = append(s, { ...base, kind: "invoice", audience: "standard", buyer: buyerOf(najd), lines: [line("مضخة حريق 50 م³/س", "2", "3500"), line("تركيب وتشغيل", "1", "2000", "250")] }, najd.id, daysAgo(6, 3));
  s = append(s, { ...base, kind: "invoice", audience: "simplified", paymentMeans: "card", lines: [line("طفاية حريق بودرة 6 كغ", "3", "95")] }, "", daysAgo(5, 1));
  s = append(s, { ...base, kind: "invoice", audience: "standard", buyer: buyerOf(gulf), lines: [line("صمام بوابة 4 بوصة", "12", "185"), line("خرطوم حريق 30 م", "6", "240")] }, gulf.id, daysAgo(4, 5));
  s = append(s, { ...base, kind: "invoice", audience: "standard", buyer: buyerOf(sidra), paymentMeans: "credit", lines: [line("صيانة نظام إطفاء المطبخ", "1", "1800"), line("تعبئة أسطوانات", "4", "75")] }, sidra.id, daysAgo(3, 2));
  s = append(s, { ...base, kind: "invoice", audience: "simplified", paymentMeans: "cash", lines: [line("كاشف دخان", "2", "65"), line("بطارية 9 فولت", "2", "12")] }, "", daysAgo(1, 4));
  s = append(
    s,
    {
      ...base,
      kind: "credit_note",
      audience: "standard",
      buyer: buyerOf(najd),
      billingReference: s.docs[0]!.number,
      noteReason: "إرجاع مضخة واحدة",
      lines: [line("مضخة حريق 50 م³/س", "1", "3500")],
    },
    najd.id,
    daysAgo(0, 2),
  );
  return s;
}

const STORE_KEY = "khatm-demo-v2";

export function loadStore(): Store | undefined {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const s = raw ? (JSON.parse(raw) as Store) : undefined;
    // Anything saved by an older shape of the demo is dropped rather than half-rendered.
    const ok =
      s &&
      Array.isArray(s.docs) &&
      Array.isArray(s.customers) &&
      typeof s.docCustomer === "object" &&
      s.docs.every((d) => d && d.uuid && d.totals?.lines && d.input?.lines && d.input.seller && typeof d.xml === "string");
    return ok ? s : undefined;
  } catch {
    return undefined;
  }
}

export function saveStore(s: Store) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ ...s, docs: s.docs.slice(-60) }));
  } catch {
    // The demo keeps working in memory.
  }
}

export function clearStore() {
  try {
    localStorage.removeItem(STORE_KEY);
  } catch {
    // Nothing stored.
  }
}
