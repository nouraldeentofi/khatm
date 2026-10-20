// Validation comes from @khatm/zatca in English; customers see it in Arabic.

const FIELD_LABELS: Record<string, string> = {
  buyer: "بيانات العميل",
  "buyer.name": "اسم العميل",
  "buyer.vatNumber": "الرقم الضريبي للعميل",
  "buyer.idValue": "السجل التجاري للعميل",
  "buyer.address": "عنوان العميل",
  "buyer.address.street": "الشارع",
  "buyer.address.buildingNumber": "رقم المبنى",
  "buyer.address.district": "الحي",
  "buyer.address.city": "المدينة",
  "buyer.address.postalCode": "الرمز البريدي",
  billingReference: "الفاتورة الأصلية",
  noteReason: "سبب الإشعار",
  "allowances.0.amount": "الخصم على الفاتورة",
};

const LINE_FIELDS: Record<string, string> = {
  name: "الوصف",
  quantity: "الكمية",
  unitPrice: "السعر",
  discount: "الخصم",
};

const MESSAGES: Array<[RegExp, string, boolean]> = [
  // [english, arabic, standalone (no field label needed)]
  [/must reference the original invoice/, "حدّد الفاتورة الأصلية", true],
  [/must state the reason/, "اكتب سبب الإشعار", true],
  [/need the buyer's details/, "اختر العميل أو أضف عميلاً جديداً", true],
  [/VAT number or another ID/, "أدخل الرقم الضريبي للعميل أو رقم سجله التجاري", true],
  [/need the buyer's address/, "الفاتورة الضريبية تحتاج العنوان الوطني للعميل", true],
  [/Postal code must be 5 digits/, "يجب أن يكون 5 أرقام", false],
  [/Building number must be 4 digits/, "يجب أن يكون 4 أرقام", false],
  [/VAT number must be 15 digits/, "15 رقماً يبدأ وينتهي بالرقم 3", false],
  [/Discount exceeds the line amount/, "الخصم أكبر من قيمة البند", false],
  [/non-negative number/, "أدخل رقماً صحيحاً", false],
  [/Allowances exceed the taxable amount/, "الخصم أكبر من المبلغ الخاضع للضريبة", true],
  [/has no matching lines/, "الخصم على الفاتورة يحتاج بنداً خاضعاً لضريبة 15%", true],
  [/must be alphanumeric/, "أرقام فقط", false],
];

export type Issue = { code: string; path: PropertyKey[]; message: string };

export function describeIssue(i: Issue): string {
  const path = i.path.map(String);
  let label = FIELD_LABELS[path.join(".")];
  if (!label && path[0] === "lines") label = `البند ${Number(path[1]) + 1}، ${LINE_FIELDS[path[2] ?? ""] ?? ""}`;
  const known = MESSAGES.find(([re]) => re.test(i.message));
  if (known?.[2]) return known[1];
  const message = known?.[1] ?? (i.code === "too_small" || i.code === "invalid_type" ? "مطلوب" : "غير صحيح");
  return label ? `${label}: ${message}` : message;
}

/** One message per field; missing address parts are folded into a single line. */
export function describeIssues(issues: Issue[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const missingAddress: string[] = [];
  let addressSlot = -1;
  for (const i of issues) {
    const path = i.path.map(String).join(".");
    if (seen.has(path)) continue;
    seen.add(path);
    if (path.startsWith("buyer.address.") && i.code === "too_small") {
      if (addressSlot < 0) addressSlot = out.push("") - 1;
      missingAddress.push(FIELD_LABELS[path]!);
      continue;
    }
    out.push(describeIssue(i));
  }
  if (addressSlot >= 0) out[addressSlot] = `أكمل العنوان الوطني للعميل: ${missingAddress.join("، ")}`;
  return [...new Set(out)];
}
