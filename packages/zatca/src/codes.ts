/** Document type codes (UNTDID 1001 subset). */
export const DOCUMENT_TYPE = { invoice: "388", credit_note: "381", debit_note: "383" } as const;
export type DocumentKind = keyof typeof DOCUMENT_TYPE;

/** First two digits of the 7-digit invoice transaction code (KSA-2). */
export const AUDIENCE = { standard: "01", simplified: "02" } as const;
export type Audience = keyof typeof AUDIENCE;

export type TaxCategory = "S" | "Z" | "E" | "O";

/** Seller identification schemes (BR-KSA-08). */
export const SELLER_ID_SCHEMES = ["CRN", "MOM", "MLS", "SAG", "OTH", "700"] as const;
/** Buyer identification schemes (BR-KSA-14). */
export const BUYER_ID_SCHEMES = ["TIN", "CRN", "MOM", "MLS", "700", "SAG", "NAT", "GCC", "IQA", "PAS", "OTH"] as const;

/** UNTDID 4461 subset most SMEs need. */
export const PAYMENT_MEANS = {
  cash: "10",
  credit: "30",
  bank_transfer: "42",
  card: "48",
  not_defined: "1",
} as const;
export type PaymentMeans = keyof typeof PAYMENT_MEANS;

/**
 * Exemption / zero-rating reasons (XML implementation standard §11.2.4). The English text
 * must be sent verbatim; the Arabic is for the PDF and the UI.
 */
export const EXEMPTION_REASONS = {
  "VATEX-SA-29": { category: "E", en: "Financial services mentioned in Article 29 of the VAT Regulations", ar: "الخدمات المالية" },
  "VATEX-SA-29-7": { category: "E", en: "Life insurance services mentioned in Article 29 of the VAT Regulations", ar: "عقد تأمين على الحياة" },
  "VATEX-SA-30": { category: "E", en: "Real estate transactions mentioned in Article 30 of the VAT Regulations", ar: "التوريدات العقارية المعفاة من الضريبة" },
  "VATEX-SA-32": { category: "Z", en: "Export of goods", ar: "صادرات السلع من المملكة" },
  "VATEX-SA-33": { category: "Z", en: "Export of services", ar: "صادرات الخدمات من المملكة" },
  "VATEX-SA-34-1": { category: "Z", en: "The international transport of Goods", ar: "النقل الدولي للسلع" },
  "VATEX-SA-34-2": { category: "Z", en: "international transport of passengers", ar: "النقل الدولي للركاب" },
  "VATEX-SA-34-3": { category: "Z", en: "services directly connected and incidental to a Supply of international passenger transport", ar: "الخدمات المرتبطة مباشرة أو عرضياً بتوريد النقل الدولي للركاب" },
  "VATEX-SA-34-4": { category: "Z", en: "Supply of a qualifying means of transport", ar: "توريد وسائل النقل المؤهلة" },
  "VATEX-SA-34-5": { category: "Z", en: "Any services relating to Goods or passenger transportation, as defined in article twenty five of these Regulations", ar: "الخدمات ذات الصلة بنقل السلع أو الركاب، وفقاً للتعريف الوارد بالمادة الخامسة والعشرين من اللائحة التنفيذية لنظام ضريبة القيمة المضافة" },
  "VATEX-SA-35": { category: "Z", en: "Medicines and medical equipment", ar: "الأدوية والمعدات الطبية" },
  "VATEX-SA-36": { category: "Z", en: "Qualifying metals", ar: "المعادن المؤهلة" },
  "VATEX-SA-EDU": { category: "Z", en: "Private education to citizen", ar: "الخدمات التعليمية الخاصة للمواطنين" },
  "VATEX-SA-HEA": { category: "Z", en: "Private healthcare to citizen", ar: "الخدمات الصحية الخاصة للمواطنين" },
  "VATEX-SA-MLTRY": { category: "Z", en: "supply of qualified military goods", ar: "توريد السلع العسكرية المؤهلة" },
  "VATEX-SA-OOS": { category: "O", en: "", ar: "خارج نطاق الضريبة" },
} as const satisfies Record<string, { category: TaxCategory; en: string; ar: string }>;
export type ExemptionCode = keyof typeof EXEMPTION_REASONS;
