import type { FormEvent } from "react";
import qrcode from "qrcode-generator";
import {
  EXEMPTION_REASONS,
  FIRST_PIH,
  TEST_VAT_NUMBER,
  decodeQr,
  issue,
  previewTotals,
  type Draft,
  type ExemptionCode,
  type IssuedDoc,
} from "./engine.ts";

const { useEffect, useMemo, useState } = React;

// ---------------------------------------------------------------- options

const TAX_OPTIONS = [
  { id: "S15", label: "خاضع 15%", category: "S" },
  { id: "Z32", label: "صفرية: تصدير سلع", category: "Z", code: "VATEX-SA-32" },
  { id: "Z33", label: "صفرية: تصدير خدمات", category: "Z", code: "VATEX-SA-33" },
  { id: "Z35", label: "صفرية: أدوية ومعدات طبية", category: "Z", code: "VATEX-SA-35" },
  { id: "E29", label: "معفاة: خدمات مالية", category: "E", code: "VATEX-SA-29" },
  { id: "E30", label: "معفاة: توريدات عقارية", category: "E", code: "VATEX-SA-30" },
  { id: "O", label: "خارج نطاق الضريبة", category: "O", code: "VATEX-SA-OOS" },
] as const;
type TaxId = (typeof TAX_OPTIONS)[number]["id"];

const PAYMENT_OPTIONS = [
  ["cash", "نقداً"],
  ["bank_transfer", "تحويل بنكي"],
  ["card", "بطاقة مدى / ائتمان"],
  ["credit", "آجل"],
] as const;

const DOC_TITLES: Record<string, { ar: string; en: string }> = {
  "standard:invoice": { ar: "فاتورة ضريبية", en: "Tax Invoice" },
  "simplified:invoice": { ar: "فاتورة ضريبية مبسطة", en: "Simplified Tax Invoice" },
  "standard:credit_note": { ar: "إشعار دائن", en: "Credit Note" },
  "simplified:credit_note": { ar: "إشعار دائن مبسط", en: "Simplified Credit Note" },
  "standard:debit_note": { ar: "إشعار مدين", en: "Debit Note" },
  "simplified:debit_note": { ar: "إشعار مدين مبسط", en: "Simplified Debit Note" },
};

const TYPE_CODES: Record<string, string> = { invoice: "388", credit_note: "381", debit_note: "383" };

// ---------------------------------------------------------------- state

interface LineRow {
  id: number;
  name: string;
  quantity: string;
  unitPrice: string;
  discount: string;
  tax: TaxId;
}

interface Form {
  audience: "standard" | "simplified";
  kind: "invoice" | "credit_note" | "debit_note";
  original: string;
  noteReason: string;
  payment: (typeof PAYMENT_OPTIONS)[number][0];
  invoiceDiscount: string;
  seller: { name: string; cr: string; street: string; building: string; additional: string; district: string; city: string; postal: string };
  buyer: { name: string; vat: string; cr: string; street: string; building: string; district: string; city: string; postal: string };
  lines: LineRow[];
}

const DEFAULT_FORM: Form = {
  audience: "standard",
  kind: "invoice",
  original: "",
  noteReason: "إرجاع جزء من البضاعة",
  payment: "bank_transfer",
  invoiceDiscount: "",
  seller: {
    name: "شركة توريد التكنولوجيا بأقصى سرعة المحدودة",
    cr: "1010010000",
    street: "طريق الأمير سلطان",
    building: "2322",
    additional: "8228",
    district: "المربع",
    city: "الرياض",
    postal: "23333",
  },
  buyer: {
    name: "مؤسسة نجد للتوريدات",
    vat: "399999999800003",
    cr: "",
    street: "طريق الملك فهد",
    building: "7788",
    district: "العليا",
    city: "الرياض",
    postal: "12211",
  },
  lines: [
    { id: 1, name: "توريد مضخة حريق 50 م³/س", quantity: "2", unitPrice: "3500", discount: "", tax: "S15" },
    { id: 2, name: "تركيب وتشغيل", quantity: "1", unitPrice: "2000", discount: "250", tax: "S15" },
  ],
};

const STORE_KEY = "khatm-demo-chain-v1";

function loadDocs(): IssuedDoc[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as IssuedDoc[]) : [];
  } catch {
    return [];
  }
}

function saveDocs(docs: IssuedDoc[]) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(docs.slice(-40)));
  } catch {
    // Storage is a convenience here; the chain still lives in memory.
  }
}

function toDraft(f: Form): Draft {
  const taxFields = (id: TaxId) => {
    const opt = TAX_OPTIONS.find((o) => o.id === id)!;
    if (opt.category === "S") return { taxCategory: "S" as const };
    return {
      taxCategory: opt.category,
      exemptionCode: opt.code as ExemptionCode,
      ...(opt.code === "VATEX-SA-OOS" ? { exemptionReason: "Not subject to VAT | خارج نطاق الضريبة" } : {}),
    };
  };
  const b = f.buyer;
  const buyer =
    f.audience === "standard"
      ? {
          name: b.name,
          vatNumber: b.vat || undefined,
          ...(b.vat ? {} : b.cr ? { idScheme: "CRN" as const, idValue: b.cr } : {}),
          address: b.street || b.building || b.district || b.city || b.postal
            ? { street: b.street, buildingNumber: b.building, district: b.district, city: b.city, postalCode: b.postal }
            : undefined,
        }
      : b.name
        ? { name: b.name }
        : undefined;
  const s = f.seller;
  return {
    kind: f.kind,
    audience: f.audience,
    seller: {
      name: s.name,
      vatNumber: TEST_VAT_NUMBER,
      idScheme: "CRN",
      idValue: s.cr,
      address: {
        street: s.street,
        buildingNumber: s.building,
        additionalNumber: s.additional || undefined,
        district: s.district,
        city: s.city,
        postalCode: s.postal,
      },
    },
    buyer,
    paymentMeans: f.payment,
    ...(f.kind === "invoice" ? {} : { billingReference: f.original || undefined, noteReason: f.noteReason || undefined }),
    lines: f.lines.map((l) => ({
      name: l.name,
      quantity: l.quantity.trim() || "0",
      unitPrice: l.unitPrice.trim() || "0",
      discount: l.discount.trim() || "0",
      ...taxFields(l.tax),
    })),
    allowances: f.invoiceDiscount.trim() ? [{ amount: f.invoiceDiscount.trim(), reason: "خصم على الفاتورة" }] : [],
  };
}

// ---------------------------------------------------------------- errors in Arabic

const FIELD_LABELS: Record<string, string> = {
  buyer: "بيانات المشتري",
  "buyer.name": "اسم المشتري",
  "buyer.vatNumber": "الرقم الضريبي للمشتري",
  "buyer.idValue": "هوية المشتري",
  "buyer.address": "عنوان المشتري",
  "buyer.address.street": "شارع المشتري",
  "buyer.address.buildingNumber": "رقم مبنى المشتري",
  "buyer.address.district": "حي المشتري",
  "buyer.address.city": "مدينة المشتري",
  "buyer.address.postalCode": "الرمز البريدي للمشتري",
  "seller.name": "اسم البائع",
  "seller.idValue": "السجل التجاري للبائع",
  "seller.address.street": "شارع البائع",
  "seller.address.buildingNumber": "رقم مبنى البائع",
  "seller.address.district": "حي البائع",
  "seller.address.city": "مدينة البائع",
  "seller.address.postalCode": "الرمز البريدي للبائع",
  billingReference: "الفاتورة الأصلية",
  noteReason: "سبب الإشعار",
  "allowances.0.amount": "خصم الفاتورة",
};
const LINE_FIELDS: Record<string, string> = {
  name: "الوصف",
  quantity: "الكمية",
  unitPrice: "السعر",
  discount: "الخصم",
};
const MESSAGES: Array<[RegExp, string]> = [
  [/must reference the original invoice/, "اختر الفاتورة الأصلية اللي بيصحّحها الإشعار"],
  [/must state the reason/, "اكتب سبب إصدار الإشعار"],
  [/need the buyer's details/, "الفاتورة الضريبية بتحتاج بيانات المشتري"],
  [/VAT number or another ID/, "أدخل الرقم الضريبي للمشتري أو رقم سجله التجاري"],
  [/need the buyer's address/, "الفاتورة الضريبية بتحتاج العنوان الوطني للمشتري"],
  [/Postal code must be 5 digits/, "لازم يكون 5 أرقام"],
  [/Building number must be 4 digits/, "لازم يكون 4 أرقام"],
  [/VAT number must be 15 digits/, "15 رقماً، أوله وآخره 3"],
  [/Discount exceeds the line amount/, "الخصم أكبر من قيمة البند"],
  [/non-negative number/, "لازم يكون رقماً موجباً"],
  [/Allowances exceed the taxable amount/, "خصم الفاتورة أكبر من المبلغ الخاضع للضريبة"],
  [/has no matching lines/, "خصم الفاتورة بيحتاج بنداً واحداً على الأقل خاضعاً لـ 15%"],
  [/must be alphanumeric/, "أرقام وحروف لاتينية فقط"],
];

type Issue = { code: string; path: PropertyKey[]; message: string };

function describeIssue(i: Issue): string {
  const path = i.path.map(String);
  let label = FIELD_LABELS[path.join(".")];
  if (!label && path[0] === "lines") label = `البند ${Number(path[1]) + 1}: ${LINE_FIELDS[path[2] ?? ""] ?? ""}`;
  const known = MESSAGES.find(([re]) => re.test(i.message))?.[1];
  const message = known ?? (i.code === "too_small" || i.code === "invalid_type" ? "مطلوب" : i.code === "invalid_format" ? "صيغة غير صحيحة" : i.message);
  if (!label) return message;
  return known && /^(اختر|اكتب|الفاتورة|أدخل|خصم)/.test(known) ? message : `${label}: ${message}`;
}

// ---------------------------------------------------------------- formatting

const money = (s: string) => {
  const [int, frac = "00"] = s.replace("-", "").split(".");
  return `${s.startsWith("-") ? "−" : ""}${int!.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${frac}`;
};
const date = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const short = (h: string, n = 10) => `${h.slice(0, n)}…`;

function copy(text: string, onDone: (ok: boolean) => void) {
  navigator.clipboard.writeText(text).then(
    () => onDone(true),
    () => onDone(false),
  );
}

// ---------------------------------------------------------------- app

export function App() {
  const [form, setForm] = useState<Form>(DEFAULT_FORM);
  const [docs, setDocs] = useState<IssuedDoc[]>(() => loadDocs());
  const [selected, setSelected] = useState(() => Math.max(loadDocs().length - 1, 0));
  const [tab, setTab] = useState<"doc" | "zatca" | "xml">("doc");
  const [issueError, setIssueError] = useState<string[]>([]);
  const [confirmReset, setConfirmReset] = useState(false);

  // Open with a document already issued, so the page shows what it does.
  useEffect(() => {
    if (docs.length === 0) {
      const first = issue(toDraft(DEFAULT_FORM), { icv: 1, lastHash: FIRST_PIH, number: "KH-000001" });
      setDocs([first]);
      setSelected(0);
    }
  }, []);
  useEffect(() => saveDocs(docs), [docs]);

  const draft = useMemo(() => toDraft(form), [form]);
  const preview = useMemo(() => previewTotals(draft), [draft]);
  const problems = useMemo(() => [...new Set(preview.issues.map(describeIssue))], [preview]);

  const originals = docs.filter((d) => d.kind === "invoice" && d.audience === form.audience);
  useEffect(() => {
    if (form.kind !== "invoice" && !originals.some((d) => d.number === form.original)) {
      setForm((f) => ({ ...f, original: originals.at(-1)?.number ?? "" }));
    }
  }, [form.kind, form.audience, docs.length]);

  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));
  const setBuyer = (patch: Partial<Form["buyer"]>) => setForm((f) => ({ ...f, buyer: { ...f.buyer, ...patch } }));
  const setSeller = (patch: Partial<Form["seller"]>) => setForm((f) => ({ ...f, seller: { ...f.seller, ...patch } }));
  const setLine = (id: number, patch: Partial<LineRow>) =>
    setForm((f) => ({ ...f, lines: f.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)) }));
  const addLine = () =>
    setForm((f) => ({
      ...f,
      lines: [...f.lines, { id: Math.max(0, ...f.lines.map((l) => l.id)) + 1, name: "", quantity: "1", unitPrice: "", discount: "", tax: "S15" }],
    }));
  const removeLine = (id: number) => setForm((f) => ({ ...f, lines: f.lines.length > 1 ? f.lines.filter((l) => l.id !== id) : f.lines }));

  const onIssue = (e: FormEvent) => {
    e.preventDefault();
    if (problems.length) {
      setIssueError(problems);
      return;
    }
    try {
      const last = docs.at(-1);
      const next = issue(draft, {
        icv: (last?.icv ?? 0) + 1,
        lastHash: last?.hash ?? FIRST_PIH,
        number: `KH-${String((last?.icv ?? 0) + 1).padStart(6, "0")}`,
      });
      setDocs([...docs, next]);
      setSelected(docs.length);
      setIssueError([]);
      setTab("doc");
    } catch (err) {
      setIssueError([String((err as Error).message)]);
    }
  };

  const reset = () => {
    setDocs([issue(toDraft(DEFAULT_FORM), { icv: 1, lastHash: FIRST_PIH, number: "KH-000001" })]);
    setSelected(0);
    setConfirmReset(false);
    setTab("doc");
  };

  const doc = docs[selected];
  const prev = doc ? docs[docs.indexOf(doc) - 1] : undefined;

  return (
    <>
      <header className="top">
        <div className="brand">
          <span className="stamp" aria-hidden="true">ختم</span>
          <div className="brand-text">
            <strong>ختم</strong>
            <span>محرّك فوترة إلكترونية للمرحلة الثانية من زاتكا</span>
          </div>
        </div>
        <p className="env">
          <span className="env-dot" aria-hidden="true" />
          نسخة تجريبية: التوقيع بشهادة زاتكا التجريبية، وما في إرسال لزاتكا
        </p>
      </header>

      <main className="workspace">
        <form className="composer" onSubmit={onIssue} noValidate>
          <div className="section-head">
            <h2>مستند جديد</h2>
            <span className="hint">بيتوقّع ويرتبط بالسلسلة لحظة الإصدار</span>
          </div>

          <div className="choices">
            <fieldset className="choice">
              <legend>نوع الفاتورة</legend>
              <div className="segmented">
              {(
                [
                  ["standard", "ضريبية", "منشأة لمنشأة · Clearance"],
                  ["simplified", "مبسطة", "للمستهلك · Reporting"],
                ] as const
              ).map(([value, label, sub]) => (
                <label key={value} className={form.audience === value ? "on" : ""}>
                  <input type="radio" name="audience" id={`audience-${value}`} checked={form.audience === value} onChange={() => set({ audience: value })} />
                  <span>{label}</span>
                  <small>{sub}</small>
                </label>
              ))}
              </div>
            </fieldset>
            <fieldset className="choice">
              <legend>المستند</legend>
              <div className="segmented three">
              {(
                [
                  ["invoice", "فاتورة", "388"],
                  ["credit_note", "إشعار دائن", "381"],
                  ["debit_note", "إشعار مدين", "383"],
                ] as const
              ).map(([value, label, code]) => (
                <label key={value} className={form.kind === value ? "on" : ""}>
                  <input type="radio" name="kind" id={`kind-${value}`} checked={form.kind === value} onChange={() => set({ kind: value })} />
                  <span>{label}</span>
                  <small className="mono">{code}</small>
                </label>
              ))}
              </div>
            </fieldset>
          </div>

          {form.kind !== "invoice" && (
            <div className="grid two note-fields">
              <label className="field">
                <span>الفاتورة الأصلية</span>
                {originals.length ? (
                  <select id="original" value={form.original} onChange={(e) => set({ original: e.target.value })}>
                    {originals.map((d) => (
                      <option key={d.number} value={d.number}>
                        {d.number} · {money(d.totals.payable)} ر.س
                      </option>
                    ))}
                  </select>
                ) : (
                  <input id="original" value={form.original} placeholder="مثلاً KH-000001" onChange={(e) => set({ original: e.target.value })} />
                )}
              </label>
              <label className="field">
                <span>سبب الإشعار</span>
                <input id="note-reason" value={form.noteReason} onChange={(e) => set({ noteReason: e.target.value })} />
              </label>
            </div>
          )}

          <details className="party">
            <summary>
              <span>البائع</span>
              <span className="summary-value">{form.seller.name}</span>
            </summary>
            <div className="grid two">
              <label className="field wide">
                <span>الاسم كما في السجل التجاري</span>
                <input id="seller-name" value={form.seller.name} onChange={(e) => setSeller({ name: e.target.value })} />
              </label>
              <label className="field">
                <span>الرقم الضريبي</span>
                <input id="seller-vat" value={TEST_VAT_NUMBER} readOnly dir="ltr" className="mono" />
                <small>مربوط بشهادة الجهاز التجريبية</small>
              </label>
              <label className="field">
                <span>السجل التجاري</span>
                <input id="seller-cr" value={form.seller.cr} dir="ltr" inputMode="numeric" className="mono" onChange={(e) => setSeller({ cr: e.target.value })} />
              </label>
              <Address
                prefix="seller"
                value={{ street: form.seller.street, building: form.seller.building, district: form.seller.district, city: form.seller.city, postal: form.seller.postal }}
                onChange={setSeller}
              />
            </div>
          </details>

          <fieldset className="party open">
            <legend>
              المشتري
              {form.audience === "simplified" && <small> · اختياري في الفاتورة المبسطة</small>}
            </legend>
            {form.audience === "standard" ? (
              <div className="grid two">
                <label className="field wide">
                  <span>اسم المنشأة</span>
                  <input id="buyer-name" value={form.buyer.name} onChange={(e) => setBuyer({ name: e.target.value })} />
                </label>
                <label className="field">
                  <span>الرقم الضريبي</span>
                  <input id="buyer-vat" value={form.buyer.vat} dir="ltr" inputMode="numeric" className="mono" placeholder="3XXXXXXXXXXXXX3" onChange={(e) => setBuyer({ vat: e.target.value.trim() })} />
                </label>
                <label className="field">
                  <span>أو السجل التجاري</span>
                  <input id="buyer-cr" value={form.buyer.cr} dir="ltr" inputMode="numeric" className="mono" disabled={Boolean(form.buyer.vat)} onChange={(e) => setBuyer({ cr: e.target.value.trim() })} />
                </label>
                <Address prefix="buyer" value={form.buyer} onChange={setBuyer} />
              </div>
            ) : (
              <label className="field">
                <span>اسم العميل</span>
                <input id="buyer-name-simple" value={form.buyer.name} placeholder="عميل نقدي" onChange={(e) => setBuyer({ name: e.target.value })} />
              </label>
            )}
          </fieldset>

          <fieldset className="lines">
            <legend>البنود</legend>
            <div className="line-head" aria-hidden="true">
              <span>الوصف</span>
              <span>الكمية</span>
              <span>السعر</span>
              <span>الخصم</span>
              <span>الضريبة</span>
              <span />
            </div>
            {form.lines.map((l, i) => (
              <div className="line" key={l.id}>
                <input id={`line-${l.id}-name`} className="l-name" aria-label={`وصف البند ${i + 1}`} value={l.name} placeholder="وصف السلعة أو الخدمة" onChange={(e) => setLine(l.id, { name: e.target.value })} />
                <input id={`line-${l.id}-qty`} className="l-qty mono" aria-label="الكمية" dir="ltr" inputMode="decimal" value={l.quantity} onChange={(e) => setLine(l.id, { quantity: e.target.value })} />
                <input id={`line-${l.id}-price`} className="l-price mono" aria-label="سعر الوحدة قبل الضريبة" dir="ltr" inputMode="decimal" placeholder="0.00" value={l.unitPrice} onChange={(e) => setLine(l.id, { unitPrice: e.target.value })} />
                <input id={`line-${l.id}-disc`} className="l-disc mono" aria-label="خصم البند" dir="ltr" inputMode="decimal" placeholder="0" value={l.discount} onChange={(e) => setLine(l.id, { discount: e.target.value })} />
                <select id={`line-${l.id}-tax`} className="l-tax" aria-label="فئة الضريبة" value={l.tax} onChange={(e) => setLine(l.id, { tax: e.target.value as TaxId })}>
                  {TAX_OPTIONS.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <button type="button" className="l-remove" aria-label={`حذف البند ${i + 1}`} disabled={form.lines.length === 1} onClick={() => removeLine(l.id)}>
                  ×
                </button>
              </div>
            ))}
            <button type="button" className="add-line" onClick={addLine}>
              + إضافة بند
            </button>
          </fieldset>

          <div className="grid two">
            <label className="field">
              <span>طريقة الدفع</span>
              <select id="payment" value={form.payment} onChange={(e) => set({ payment: e.target.value as Form["payment"] })}>
                {PAYMENT_OPTIONS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>خصم على الفاتورة (ر.س)</span>
              <input id="invoice-discount" dir="ltr" inputMode="decimal" className="mono" placeholder="0.00" value={form.invoiceDiscount} onChange={(e) => set({ invoiceDiscount: e.target.value })} />
            </label>
          </div>

          <div className="summary" aria-live="polite">
            {preview.totals ? (
              <>
                <div>
                  <span>قبل الضريبة</span>
                  <b className="num">{money(preview.totals.taxExclusive)}</b>
                </div>
                <div>
                  <span>ضريبة القيمة المضافة</span>
                  <b className="num">{money(preview.totals.vatTotal)}</b>
                </div>
                <div className="grand">
                  <span>الإجمالي المستحق</span>
                  <b className="num">
                    {money(preview.totals.payable)} <small>ر.س</small>
                  </b>
                </div>
              </>
            ) : (
              <p className="muted">الإجماليات بتظهر لما تكتمل البيانات.</p>
            )}
          </div>

          {(issueError.length > 0 || problems.length > 0) && (
            <ul className={`problems ${issueError.length ? "loud" : ""}`}>
              {(issueError.length ? issueError : problems).map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}

          <div className="issue-row">
            <button type="submit" className="primary" id="issue">
              إصدار وتوقيع
            </button>
            <p className="hint">
              المستند رقم <b className="mono">{(docs.at(-1)?.icv ?? 0) + 1}</b> على هالجهاز. الإصدار نهائي، والتصحيح بيكون بإشعار.
            </p>
          </div>
        </form>

        <section className="output" aria-label="المستندات الصادرة">
          <div className="chain-head">
            <h2>سلسلة الجهاز</h2>
            <span className="hint">كل مستند بيحمل تجزئة اللي قبله (PIH)</span>
            {confirmReset ? (
              <span className="confirm">
                بيمسح السلسلة ويبدأ من العداد 1.
                <button type="button" className="danger-link" onClick={reset}>
                  امسح
                </button>
                <button type="button" className="link" onClick={() => setConfirmReset(false)}>
                  تراجع
                </button>
              </span>
            ) : (
              <button type="button" className="link" onClick={() => setConfirmReset(true)}>
                ابدأ سلسلة جديدة
              </button>
            )}
          </div>
          <ol className="chain">
            {docs.map((d, i) => (
              <li key={d.uuid}>
                <button type="button" className={i === selected ? "on" : ""} onClick={() => setSelected(i)} aria-current={i === selected}>
                  <span className="icv mono">#{d.icv}</span>
                  <span className="chain-title">{DOC_TITLES[`${d.audience}:${d.kind}`]!.ar}</span>
                  <span className="chain-hash mono">{short(d.hash, 8)}</span>
                </button>
              </li>
            ))}
          </ol>

          {doc && (
            <>
              <div className="tabs" role="tablist">
                {(
                  [
                    ["doc", "الفاتورة"],
                    ["zatca", "ما تراه زاتكا"],
                    ["xml", "ملف XML"],
                  ] as const
                ).map(([id, label]) => (
                  <button key={id} type="button" role="tab" id={`tab-${id}`} aria-selected={tab === id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>
                    {label}
                  </button>
                ))}
              </div>
              {tab === "doc" && <InvoicePaper doc={doc} />}
              {tab === "zatca" && <ZatcaView doc={doc} prev={prev} />}
              {tab === "xml" && <XmlView doc={doc} />}
            </>
          )}
        </section>
      </main>

      <footer className="foot">
        <p>
          كل شي بهالصفحة بيشتغل بمتصفحك بنفس كود المنصة: بناء الفاتورة بصيغة UBL 2.1، التجزئة، التوقيع، ورمز QR. الشهادة هي الشهادة التجريبية المنشورة بحزمة زاتكا للمطورين، فالمستندات هون
          للتجربة وما إلها أي أثر ضريبي.
        </p>
      </footer>
    </>
  );
}

type AddressFields = { street: string; building: string; district: string; city: string; postal: string };

function Address({
  prefix,
  value,
  onChange,
}: {
  prefix: string;
  value: AddressFields;
  onChange: (patch: Partial<AddressFields>) => void;
}) {
  const f = (key: keyof AddressFields, label: string, opts: { mono?: boolean; wide?: boolean } = {}) => (
    <label className={`field ${opts.wide ? "wide" : ""}`}>
      <span>{label}</span>
      <input
        id={`${prefix}-${key}`}
        value={value[key]}
        dir={opts.mono ? "ltr" : undefined}
        inputMode={opts.mono ? "numeric" : undefined}
        className={opts.mono ? "mono" : undefined}
        onChange={(e) => onChange({ [key]: e.target.value })}
      />
    </label>
  );
  return (
    <>
      {f("street", "الشارع", { wide: true })}
      {f("building", "رقم المبنى", { mono: true })}
      {f("district", "الحي")}
      {f("city", "المدينة")}
      {f("postal", "الرمز البريدي", { mono: true })}
    </>
  );
}

function Qr({ data }: { data: string }) {
  const svg = useMemo(() => {
    const q = qrcode(0, "M");
    q.addData(data, "Byte");
    q.make();
    return q.createSvgTag({ cellSize: 3, margin: 0, scalable: true });
  }, [data]);
  return <div className="qr" role="img" aria-label="رمز QR للفاتورة" dangerouslySetInnerHTML={{ __html: svg }} />;
}

function InvoicePaper({ doc }: { doc: IssuedDoc }) {
  const title = DOC_TITLES[`${doc.audience}:${doc.kind}`]!;
  const s = doc.input.seller;
  const b = doc.input.buyer;
  const t = doc.totals;
  const hasLineDiscount = doc.input.lines.some((l) => Number(l.discount ?? 0) > 0);
  return (
    <article className="paper" aria-label={`${title.ar} ${doc.number}`}>
      <div className="watermark" aria-hidden="true">
        نسخة تجريبية
      </div>
      <header className="paper-head">
        <div className="seller">
          <h3>{s.name}</h3>
          <p>
            الرقم الضريبي <span className="mono">{s.vatNumber}</span> · س.ت <span className="mono">{s.idValue}</span>
          </p>
          <p>
            {s.address.street}، مبنى {s.address.buildingNumber}، {s.address.district}، {s.address.city} {s.address.postalCode}
          </p>
        </div>
        <div className="doc-title">
          <h3>{title.ar}</h3>
          <span>{title.en}</span>
        </div>
      </header>

      <dl className="meta">
        <div>
          <dt>رقم المستند</dt>
          <dd className="mono">{doc.number}</dd>
        </div>
        <div>
          <dt>تاريخ الإصدار</dt>
          <dd className="mono">
            {date(doc.issueDate)} {doc.issueTime}
          </dd>
        </div>
        {doc.audience === "standard" && (
          <div>
            <dt>تاريخ التوريد</dt>
            <dd className="mono">{date(doc.input.supplyDate ?? doc.issueDate)}</dd>
          </div>
        )}
        {doc.input.billingReference && (
          <div>
            <dt>عن الفاتورة</dt>
            <dd className="mono">{doc.input.billingReference}</dd>
          </div>
        )}
      </dl>

      {doc.input.noteReason && (
        <p className="reason">
          <b>سبب الإشعار:</b> {doc.input.noteReason}
        </p>
      )}

      {b && (
        <section className="buyer">
          <h4>العميل</h4>
          <p className="buyer-name">{b.name}</p>
          {b.vatNumber && (
            <p>
              الرقم الضريبي <span className="mono">{b.vatNumber}</span>
            </p>
          )}
          {!b.vatNumber && b.idValue && (
            <p>
              السجل التجاري <span className="mono">{b.idValue}</span>
            </p>
          )}
          {b.address && (
            <p>
              {b.address.street}، مبنى {b.address.buildingNumber}، {b.address.district}، {b.address.city} {b.address.postalCode}
            </p>
          )}
        </section>
      )}

      <div className="table-wrap">
        <table className="items">
          <thead>
            <tr>
              <th>#</th>
              <th className="desc">الوصف</th>
              <th>الكمية</th>
              <th>سعر الوحدة</th>
              {hasLineDiscount && <th>الخصم</th>}
              <th>الخاضع للضريبة</th>
              <th>النسبة</th>
              <th>الضريبة</th>
              <th>الإجمالي</th>
            </tr>
          </thead>
          <tbody>
            {doc.input.lines.map((l, i) => (
              <tr key={i}>
                <td className="num">{i + 1}</td>
                <td className="desc">{l.name}</td>
                <td className="num">{String(l.quantity)}</td>
                <td className="num">{money(Number(l.unitPrice).toFixed(2))}</td>
                {hasLineDiscount && <td className="num">{Number(l.discount ?? 0) > 0 ? money(Number(l.discount).toFixed(2)) : "—"}</td>}
                <td className="num">{money(t.lines[i]!.net)}</td>
                <td className="num">{Number(t.lines[i]!.percent)}%</td>
                <td className="num">{money(t.lines[i]!.vat)}</td>
                <td className="num">{money(t.lines[i]!.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="paper-foot">
        <div className="qr-block">
          <Qr data={doc.qr} />
          <small>امسح الرمز للتحقق من بيانات الفاتورة</small>
        </div>
        <dl className="totals">
          <div>
            <dt>الإجمالي قبل الخصم</dt>
            <dd className="num">{money(t.lineExtension)}</dd>
          </div>
          {Number(t.allowanceTotal) > 0 && (
            <div>
              <dt>خصم على الفاتورة</dt>
              <dd className="num">−{money(t.allowanceTotal)}</dd>
            </div>
          )}
          <div>
            <dt>الإجمالي غير شامل الضريبة</dt>
            <dd className="num">{money(t.taxExclusive)}</dd>
          </div>
          {t.subtotals.map((st) => (
            <div key={`${st.category}${st.percent}${st.reason ?? ""}`} className="sub">
              <dt>
                {st.category === "S"
                  ? `ضريبة القيمة المضافة ${Number(st.percent)}%`
                  : `${EXEMPTION_REASONS[st.reason as ExemptionCode]?.ar ?? st.category} (${money(st.taxable)})`}
              </dt>
              <dd className="num">{money(st.vat)}</dd>
            </div>
          ))}
          <div className="grand">
            <dt>الإجمالي المستحق</dt>
            <dd className="num">
              {money(t.payable)} <small>ر.س</small>
            </dd>
          </div>
        </dl>
      </div>
      <p className="paper-note">
        مستند تجريبي موقّع بشهادة زاتكا التجريبية · ليس فاتورة ضريبية · رمز النوع <span className="mono">{TYPE_CODES[doc.kind]}</span> /{" "}
        <span className="mono">{doc.audience === "standard" ? "0100000" : "0200000"}</span>
      </p>
    </article>
  );
}

const QR_TAGS: Record<number, string> = {
  1: "اسم البائع",
  2: "الرقم الضريبي",
  3: "وقت الإصدار",
  4: "المبلغ المستحق",
  5: "ضريبة القيمة المضافة",
  6: "تجزئة الفاتورة",
  7: "التوقيع الرقمي",
  8: "المفتاح العام",
  9: "توقيع زاتكا على الشهادة",
};

function ZatcaView({ doc, prev }: { doc: IssuedDoc; prev?: IssuedDoc }) {
  const tags = useMemo(() => [...decodeQr(doc.qr).entries()], [doc.qr]);
  const pihOk = prev ? doc.pih === prev.hash : doc.pih === FIRST_PIH;
  return (
    <section className="zatca">
      <p className="lede">
        {doc.audience === "standard"
          ? "الفاتورة الضريبية بتنبعت لزاتكا قبل ما توصل للمشتري (Clearance)، وزاتكا بترجّعها مختومة. هاد اللي بيتحقق منه:"
          : "الفاتورة المبسطة بتنعطى للعميل فوراً، وبتنبلّغ لزاتكا خلال 24 ساعة (Reporting). هاد اللي بيتحقق منه:"}
      </p>
      <dl className="facts">
        <div>
          <dt>عداد الفواتير (ICV)</dt>
          <dd className="mono">{doc.icv}</dd>
        </div>
        <div>
          <dt>المعرّف الفريد (UUID)</dt>
          <dd className="mono">{doc.uuid}</dd>
        </div>
        <div>
          <dt>تجزئة المستند السابق (PIH)</dt>
          <dd className="mono">
            {doc.pih}
            <span className={`check ${pihOk ? "ok" : "bad"}`}>
              {prev ? (pihOk ? `تطابق تجزئة #${prev.icv}` : "لا تطابق المستند السابق") : "القيمة الابتدائية لأول مستند"}
            </span>
          </dd>
        </div>
        <div>
          <dt>تجزئة هذا المستند</dt>
          <dd className="mono">{doc.hash}</dd>
        </div>
        <div>
          <dt>التوقيع (ECDSA secp256k1)</dt>
          <dd className="mono clamp">{doc.signature}</dd>
        </div>
      </dl>
      <h4>محتوى رمز QR</h4>
      <div className="table-wrap">
        <table className="tags">
          <tbody>
            {tags.map(([tag, value]) => (
              <tr key={tag}>
                <td className="num">{tag}</td>
                <td>{QR_TAGS[tag]}</td>
                <td className="mono value">{tag <= 7 ? value.toString("utf8") : `${value.length} بايت · ${short(value.toString("base64"), 24)}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function XmlView({ doc }: { doc: IssuedDoc }) {
  const [copied, setCopied] = useState<"" | "yes" | "no">("");
  useEffect(() => setCopied(""), [doc.uuid]);
  return (
    <section className="xml">
      <div className="xml-bar">
        <span className="hint">
          UBL 2.1 · {Math.round(new Blob([doc.xml]).size / 1024)} ك.ب · هاد الملف هو السجل القانوني، والـ PDF بيتولّد منه
        </span>
        <button type="button" className="secondary" onClick={() => copy(doc.xml, (ok) => setCopied(ok ? "yes" : "no"))}>
          {copied === "yes" ? "تم النسخ" : "انسخ XML"}
        </button>
      </div>
      {copied === "no" && <p className="hint">النسخ مش متاح هون. حدّد النص من المربع وانسخه يدوياً.</p>}
      <pre dir="ltr" tabIndex={0}>
        <code>{doc.xml}</code>
      </pre>
    </section>
  );
}
