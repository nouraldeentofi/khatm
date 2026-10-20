import type { View } from "../app.tsx";
import type { Store } from "../data.ts";
import type { IssuedDoc } from "../engine.ts";
import { gregorian, money, monthLabel } from "../format.ts";

const { useMemo, useState } = React;

export const KIND_LABEL: Record<string, string> = {
  "standard:invoice": "فاتورة ضريبية",
  "simplified:invoice": "فاتورة مبسطة",
  "standard:credit_note": "إشعار دائن",
  "simplified:credit_note": "إشعار دائن",
  "standard:debit_note": "إشعار مدين",
  "simplified:debit_note": "إشعار مدين",
};

/** Credit notes reduce what the customer owes. */
export const signed = (d: IssuedDoc, amount: string) => (d.kind === "credit_note" ? -Number(amount) : Number(amount));

export function InvoiceList({ store, go }: { store: Store; go: (v: View) => void }) {
  const [filter, setFilter] = useState<string>("all");

  const groups = useMemo(() => {
    const counts = new Map<string, number>();
    for (const d of store.docs) {
      const key = store.docCustomer[d.uuid] ?? "";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const named = store.customers.filter((c) => counts.has(c.id)).map((c) => ({ key: c.id, label: c.name, count: counts.get(c.id)! }));
    const walkIn = counts.get("") ? [{ key: "", label: "عملاء أفراد", count: counts.get("")! }] : [];
    return [...named, ...walkIn];
  }, [store]);

  const docs = store.docs.filter((d) => filter === "all" || (store.docCustomer[d.uuid] ?? "") === filter).slice().reverse();
  const sales = docs.reduce((sum, d) => sum + signed(d, d.totals.payable), 0);
  const vat = docs.reduce((sum, d) => sum + signed(d, d.totals.vatTotal), 0);
  const scope = filter === "all" ? "كل العملاء" : groups.find((g) => g.key === filter)?.label;

  return (
    <section className="list-page">
      <div className="page-head">
        <div>
          <h1>الفواتير</h1>
          <p className="sub">{monthLabel(new Date())}</p>
        </div>
        <button type="button" className="btn primary" id="new-invoice" onClick={() => go({ name: "new", start: { kind: "invoice" } })}>
          فاتورة جديدة
        </button>
      </div>

      <dl className="figures" aria-label={`ملخص ${scope}`}>
        <div>
          <dt>المبيعات شاملة الضريبة</dt>
          <dd>
            <span className="num">{money(sales)}</span> <span className="cur">ر.س</span>
          </dd>
        </div>
        <div>
          <dt>ضريبة القيمة المضافة</dt>
          <dd>
            <span className="num">{money(vat)}</span> <span className="cur">ر.س</span>
          </dd>
        </div>
        <div>
          <dt>المستندات</dt>
          <dd>{docs.length}</dd>
        </div>
      </dl>

      <nav className="filters" aria-label="تصفية حسب العميل">
        <button type="button" className={filter === "all" ? "on" : ""} onClick={() => setFilter("all")}>
          الكل <span className="count">{store.docs.length}</span>
        </button>
        {groups.map((g) => (
          <button type="button" key={g.key || "walk-in"} className={filter === g.key ? "on" : ""} onClick={() => setFilter(g.key)}>
            {g.label} <span className="count">{g.count}</span>
          </button>
        ))}
      </nav>

      <div className="rows" role="table" aria-label="قائمة المستندات">
        <div className="row head" role="row">
          <span role="columnheader">الرقم</span>
          <span role="columnheader">العميل</span>
          <span role="columnheader">النوع</span>
          <span role="columnheader">التاريخ</span>
          <span role="columnheader" className="amount">المبلغ</span>
          <span role="columnheader">الحالة</span>
        </div>
        {docs.map((d) => (
          <button type="button" role="row" key={d.uuid} className="row" onClick={() => go({ name: "doc", uuid: d.uuid })}>
            <span role="cell" className="ltr doc-no">{d.number}</span>
            <span role="cell" className="who">{d.input.buyer?.name ?? "عميل نقدي"}</span>
            <span role="cell" className="kind">{KIND_LABEL[`${d.audience}:${d.kind}`]}</span>
            <span role="cell" className="date">{gregorian(d.issueDate)}</span>
            <span role="cell" className={`amount ${d.kind === "credit_note" ? "minus" : ""}`}>
              {money(signed(d, d.totals.payable))}
            </span>
            <span role="cell" className="state">
              <i aria-hidden="true" /> موقّعة
            </span>
          </button>
        ))}
        {docs.length === 0 && <p className="empty">لا توجد مستندات لهذا العميل بعد.</p>}
      </div>
    </section>
  );
}
