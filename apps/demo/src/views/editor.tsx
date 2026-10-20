import type { FormEvent } from "react";
import {
  PAYMENT_OPTIONS,
  SELLER,
  TAX_OPTIONS,
  append,
  buyerOf,
  taxFields,
  taxIdOf,
  type Customer,
  type LineRow,
  type Payment,
  type Store,
  type TaxId,
} from "../data.ts";
import { previewTotals, type Draft } from "../engine.ts";
import { describeIssues } from "../errors.ts";
import { gregorian, hijri, money } from "../format.ts";

const { useMemo, useState } = React;

export type EditorStart = { kind: "invoice"; from?: undefined } | { kind: "credit_note" | "debit_note"; from: string };

const NEW_CUSTOMER = "__new";
const EMPTY_CUSTOMER = { name: "", vatNumber: "", crNumber: "", street: "", building: "", district: "", city: "", postal: "" };
const REASONS = {
  credit_note: ["إرجاع بضاعة", "خصم بعد البيع", "تصحيح سعر", "إلغاء خدمة"],
  debit_note: ["فرق سعر", "خدمة إضافية", "رسوم توصيل لم تُحتسب"],
};

let lineKey = 100;
const emptyLine = (): LineRow => ({ key: lineKey++, name: "", quantity: "1", unitPrice: "", discount: "", tax: "S15" });

export function Editor({
  store,
  start,
  onCancel,
  onIssued,
}: {
  store: Store;
  start: EditorStart;
  onCancel: () => void;
  onIssued: (next: Store, uuid: string) => void;
}) {
  const original = start.from ? store.docs.find((d) => d.uuid === start.from) : undefined;
  const isNote = start.kind !== "invoice";

  const [audience, setAudience] = useState<"standard" | "simplified">(original?.audience ?? "standard");
  const [customerId, setCustomerId] = useState<string>(original ? (store.docCustomer[original.uuid] ?? "") : (store.customers[0]?.id ?? NEW_CUSTOMER));
  const [fresh, setFresh] = useState(EMPTY_CUSTOMER);
  const [walkIn, setWalkIn] = useState(original?.audience === "simplified" ? (original.input.buyer?.name ?? "") : "");
  const [lines, setLines] = useState<LineRow[]>(() =>
    original && start.kind === "credit_note"
      ? original.input.lines.map((l) => ({
          key: lineKey++,
          name: l.name,
          quantity: String(l.quantity),
          unitPrice: String(l.unitPrice),
          discount: Number(l.discount ?? 0) > 0 ? String(l.discount) : "",
          tax: taxIdOf(l),
        }))
      : [emptyLine()],
  );
  const [payment, setPayment] = useState<Payment>((original?.input.paymentMeans as Payment) ?? "bank_transfer");
  const [discountOpen, setDiscountOpen] = useState(false);
  const [discount, setDiscount] = useState("");
  const [reason, setReason] = useState("");
  const [attempted, setAttempted] = useState(false);

  const customer: Customer | undefined =
    customerId === NEW_CUSTOMER ? { id: NEW_CUSTOMER, ...fresh } : store.customers.find((c) => c.id === customerId);

  const draft: Draft = useMemo(
    () => ({
      kind: start.kind,
      audience,
      seller: SELLER,
      buyer: audience === "standard" ? (customer ? buyerOf(customer) : undefined) : walkIn.trim() ? { name: walkIn.trim() } : undefined,
      paymentMeans: payment,
      ...(isNote ? { billingReference: original?.number, noteReason: reason.trim() || undefined } : {}),
      lines: lines.map((l) => ({
        name: l.name.trim(),
        quantity: l.quantity.trim() || "0",
        unitPrice: l.unitPrice.trim() || "0",
        discount: l.discount.trim() || "0",
        ...taxFields(l.tax),
      })),
      allowances: discount.trim() ? [{ amount: discount.trim(), reason: "خصم" }] : [],
    }),
    [audience, customer, walkIn, payment, reason, lines, discount],
  );

  // Totals don't depend on who the buyer is, so show them while the customer is still incomplete.
  const totals = useMemo(
    () => previewTotals({ ...draft, kind: "invoice", audience: "simplified", buyer: undefined, billingReference: undefined, noteReason: undefined }).totals,
    [draft],
  );
  const problems = useMemo(() => describeIssues(previewTotals(draft).issues), [draft]);

  const setLine = (key: number, patch: Partial<LineRow>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setAttempted(true);
    if (problems.length) return;
    let next = store;
    let id = audience === "standard" ? customerId : "";
    if (audience === "standard" && customerId === NEW_CUSTOMER) {
      id = `c${Date.now()}`;
      next = {
        ...next,
        customers: [
          ...next.customers,
          { ...fresh, id, vatNumber: fresh.vatNumber || undefined, crNumber: fresh.vatNumber ? undefined : fresh.crNumber || undefined },
        ],
      };
    }
    next = append(next, draft, id);
    onIssued(next, next.docs.at(-1)!.uuid);
  };

  const today = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
  const title =
    start.kind === "invoice" ? "فاتورة جديدة" : start.kind === "credit_note" ? `إشعار دائن على ${original?.number}` : `إشعار مدين على ${original?.number}`;
  const action = start.kind === "invoice" ? "إصدار الفاتورة" : start.kind === "credit_note" ? "إصدار الإشعار الدائن" : "إصدار الإشعار المدين";

  return (
    <form className="editor" onSubmit={submit} noValidate>
      <div className="page-head">
        <div>
          <button type="button" className="back" onClick={onCancel}>
            {original ? `الفاتورة ${original.number}` : "الفواتير"}
          </button>
          <h1>{title}</h1>
        </div>
      </div>

      <div className="editor-grid">
        <div className="editor-main">
          <section className="block" aria-labelledby="customer-h">
            <h2 id="customer-h">العميل</h2>
            {isNote ? (
              <p className="fixed-customer">
                {original?.input.buyer?.name ?? "عميل نقدي"}
                <span className="muted"> · {audience === "standard" ? "إشعار على فاتورة ضريبية" : "إشعار على فاتورة مبسطة"}</span>
              </p>
            ) : (
              <>
                <div className="audience" role="radiogroup" aria-label="نوع العميل">
                  {(
                    [
                      ["standard", "منشأة", "له رقم ضريبي أو سجل تجاري، ويحصل على فاتورة ضريبية"],
                      ["simplified", "فرد", "مستهلك نهائي، ويحصل على فاتورة مبسطة"],
                    ] as const
                  ).map(([value, label, hint]) => (
                    <label key={value} className={audience === value ? "on" : ""}>
                      <input type="radio" name="audience" id={`audience-${value}`} checked={audience === value} onChange={() => setAudience(value)} />
                      <b>{label}</b>
                      <span>{hint}</span>
                    </label>
                  ))}
                </div>

                {audience === "standard" ? (
                  <div className="customer-pick">
                    <label className="field">
                      <span>المنشأة</span>
                      <select id="customer" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                        {store.customers.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                        <option value={NEW_CUSTOMER}>عميل جديد…</option>
                      </select>
                    </label>
                    {customerId === NEW_CUSTOMER ? (
                      <div className="fields">
                        <label className="field span-2">
                          <span>اسم المنشأة</span>
                          <input id="new-name" value={fresh.name} onChange={(e) => setFresh({ ...fresh, name: e.target.value })} />
                        </label>
                        <label className="field">
                          <span>الرقم الضريبي</span>
                          <input id="new-vat" className="ltr" inputMode="numeric" placeholder="3xxxxxxxxxxxxx3" value={fresh.vatNumber} onChange={(e) => setFresh({ ...fresh, vatNumber: e.target.value.trim() })} />
                        </label>
                        <label className="field">
                          <span>السجل التجاري</span>
                          <input id="new-cr" className="ltr" inputMode="numeric" placeholder="إن لم يكن مسجّلاً بالضريبة" disabled={Boolean(fresh.vatNumber)} value={fresh.crNumber} onChange={(e) => setFresh({ ...fresh, crNumber: e.target.value.trim() })} />
                        </label>
                        <label className="field span-2">
                          <span>الشارع</span>
                          <input id="new-street" value={fresh.street} onChange={(e) => setFresh({ ...fresh, street: e.target.value })} />
                        </label>
                        <label className="field">
                          <span>رقم المبنى</span>
                          <input id="new-building" className="ltr" inputMode="numeric" maxLength={4} value={fresh.building} onChange={(e) => setFresh({ ...fresh, building: e.target.value.trim() })} />
                        </label>
                        <label className="field">
                          <span>الحي</span>
                          <input id="new-district" value={fresh.district} onChange={(e) => setFresh({ ...fresh, district: e.target.value })} />
                        </label>
                        <label className="field">
                          <span>المدينة</span>
                          <input id="new-city" value={fresh.city} onChange={(e) => setFresh({ ...fresh, city: e.target.value })} />
                        </label>
                        <label className="field">
                          <span>الرمز البريدي</span>
                          <input id="new-postal" className="ltr" inputMode="numeric" maxLength={5} value={fresh.postal} onChange={(e) => setFresh({ ...fresh, postal: e.target.value.trim() })} />
                        </label>
                      </div>
                    ) : (
                      customer && (
                        <p className="customer-card">
                          {customer.vatNumber ? (
                            <>
                              الرقم الضريبي <span className="ltr">{customer.vatNumber}</span>
                            </>
                          ) : (
                            <>
                              السجل التجاري <span className="ltr">{customer.crNumber}</span>
                            </>
                          )}
                          <br />
                          {customer.street}، {customer.building}، حي {customer.district}، {customer.city} {customer.postal}
                        </p>
                      )
                    )}
                  </div>
                ) : (
                  <label className="field narrow">
                    <span>اسم العميل (اختياري)</span>
                    <input id="walk-in" value={walkIn} placeholder="عميل نقدي" onChange={(e) => setWalkIn(e.target.value)} />
                  </label>
                )}
              </>
            )}
          </section>

          {isNote && (
            <section className="block" aria-labelledby="reason-h">
              <h2 id="reason-h">سبب الإشعار</h2>
              <div className="reasons">
                {REASONS[start.kind].map((r) => (
                  <button type="button" key={r} className={reason === r ? "on" : ""} onClick={() => setReason(r)}>
                    {r}
                  </button>
                ))}
              </div>
              <input id="note-reason" aria-label="سبب الإشعار" value={reason} placeholder="أو اكتب السبب" onChange={(e) => setReason(e.target.value)} />
            </section>
          )}

          <section className="block" aria-labelledby="items-h">
            <h2 id="items-h">البنود</h2>
            <div className="items-edit">
              <div className="item-row head" aria-hidden="true">
                <span>الوصف</span>
                <span>الكمية</span>
                <span>سعر الوحدة</span>
                <span>الخصم</span>
                <span>الضريبة</span>
                <span className="end">المجموع</span>
                <span />
              </div>
              {lines.map((l, i) => (
                <div className="item-row" key={l.key}>
                  <input id={`item-${i}-name`} className="i-name" aria-label={`وصف البند ${i + 1}`} placeholder="سلعة أو خدمة" value={l.name} onChange={(e) => setLine(l.key, { name: e.target.value })} />
                  <input id={`item-${i}-qty`} className="i-qty ltr" aria-label="الكمية" inputMode="decimal" value={l.quantity} onChange={(e) => setLine(l.key, { quantity: e.target.value })} />
                  <input id={`item-${i}-price`} className="i-price ltr" aria-label="سعر الوحدة قبل الضريبة" inputMode="decimal" placeholder="0.00" value={l.unitPrice} onChange={(e) => setLine(l.key, { unitPrice: e.target.value })} />
                  <input id={`item-${i}-disc`} className="i-disc ltr" aria-label="خصم البند" inputMode="decimal" placeholder="—" value={l.discount} onChange={(e) => setLine(l.key, { discount: e.target.value })} />
                  <select id={`item-${i}-tax`} className="i-tax" aria-label="الضريبة" value={l.tax} onChange={(e) => setLine(l.key, { tax: e.target.value as TaxId })}>
                    {TAX_OPTIONS.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <span className="i-total">{totals?.lines[i] ? money(totals.lines[i]!.total) : "—"}</span>
                  <button type="button" className="i-remove" aria-label={`حذف البند ${i + 1}`} disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
            <button type="button" className="add" id="add-item" onClick={() => setLines((ls) => [...ls, emptyLine()])}>
              إضافة بند
            </button>
          </section>
        </div>

        <aside className="editor-side">
          <div className="side-card">
            <dl className="kv">
              <div>
                <dt>تاريخ الإصدار</dt>
                <dd>
                  {gregorian(today)}
                  <small>{hijri(today)}</small>
                </dd>
              </div>
            </dl>
            <label className="field">
              <span>طريقة الدفع</span>
              <select id="payment" value={payment} onChange={(e) => setPayment(e.target.value as Payment)}>
                {PAYMENT_OPTIONS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            {discountOpen ? (
              <label className="field">
                <span>خصم على الفاتورة (ر.س)</span>
                <input id="invoice-discount" className="ltr" inputMode="decimal" placeholder="0.00" value={discount} onChange={(e) => setDiscount(e.target.value)} />
              </label>
            ) : (
              <button type="button" className="text-btn" onClick={() => setDiscountOpen(true)}>
                إضافة خصم على الفاتورة
              </button>
            )}

            <dl className="sums">
              {totals && Number(totals.allowanceTotal) > 0 && (
                <>
                  <div>
                    <dt>مجموع البنود</dt>
                    <dd>{money(totals.lineExtension)}</dd>
                  </div>
                  <div>
                    <dt>خصم على الفاتورة</dt>
                    <dd>−{money(totals.allowanceTotal)}</dd>
                  </div>
                </>
              )}
              <div>
                <dt>المجموع قبل الضريبة</dt>
                <dd>{totals ? money(totals.taxExclusive) : "—"}</dd>
              </div>
              <div>
                <dt>ضريبة القيمة المضافة</dt>
                <dd>{totals ? money(totals.vatTotal) : "—"}</dd>
              </div>
              <div className="total">
                <dt>الإجمالي</dt>
                <dd>
                  {totals ? money(totals.payable) : "—"} <span className="cur">ر.س</span>
                </dd>
              </div>
            </dl>

            {attempted && problems.length > 0 && (
              <ul className="problems" role="alert">
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}

            <button type="submit" className="btn primary wide" id="issue">
              {action}
            </button>
            <p className="fine">بعد الإصدار لا تُعدَّل الفاتورة. أي تصحيح يكون بإشعار دائن أو مدين.</p>
          </div>
        </aside>
      </div>
    </form>
  );
}
