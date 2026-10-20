import qrcode from "qrcode-generator";
import type { View } from "../app.tsx";
import type { Store } from "../data.ts";
import { EXEMPTION_REASONS, type ExemptionCode, type IssuedDoc } from "../engine.ts";
import { clock, gregorian, hijri, money } from "../format.ts";

const { useMemo, useState } = React;

/**
 * Replaced with a literal at build time: true on GitHub Pages, false in the Artifact build,
 * whose frame blocks printing and downloads (the code is then dropped entirely).
 */
declare const CAN_SAVE_FILES: boolean;

const TITLES: Record<string, [string, string]> = {
  "standard:invoice": ["فاتورة ضريبية", "Tax Invoice"],
  "simplified:invoice": ["فاتورة ضريبية مبسطة", "Simplified Tax Invoice"],
  "standard:credit_note": ["إشعار دائن", "Credit Note"],
  "simplified:credit_note": ["إشعار دائن", "Credit Note"],
  "standard:debit_note": ["إشعار مدين", "Debit Note"],
  "simplified:debit_note": ["إشعار مدين", "Debit Note"],
};

const PAYMENT_LABEL: Record<string, string> = {
  bank_transfer: "تحويل بنكي",
  cash: "نقداً",
  card: "شبكة (مدى)",
  credit: "آجل",
};

export function InvoicePage({ store, uuid, go }: { store: Store; uuid: string; go: (v: View) => void }) {
  const doc = store.docs.find((d) => d.uuid === uuid);
  if (!doc) return <p className="empty">لم نجد هذا المستند.</p>;
  const original = doc.input.billingReference ? store.docs.find((d) => d.number === doc.input.billingReference) : undefined;
  const notes = store.docs.filter((d) => d.input.billingReference === doc.number);
  const [titleAr] = TITLES[`${doc.audience}:${doc.kind}`]!;

  const whatsapp = `https://wa.me/?text=${encodeURIComponent(
    `${titleAr} رقم ${doc.number}\nمن: ${doc.input.seller.name}\nالتاريخ: ${gregorian(doc.issueDate)}\nالمبلغ: ${money(doc.totals.payable)} ر.س`,
  )}`;

  return (
    <section className="doc-page">
      <div className="page-head">
        <div>
          <button type="button" className="back" onClick={() => go({ name: "list" })}>
            الفواتير
          </button>
          <h1>
            {titleAr} <span className="ltr doc-no">{doc.number}</span>
          </h1>
          <p className="sub">
            {doc.input.buyer?.name ?? "عميل نقدي"} · {gregorian(doc.issueDate)} · <span className="state"><i aria-hidden="true" /> موقّعة</span>
          </p>
        </div>
        <div className="actions">
          {CAN_SAVE_FILES && (
            <button type="button" className="btn" onClick={() => window.print()}>
              طباعة أو حفظ PDF
            </button>
          )}
          <a className="btn" href={whatsapp} target="_blank" rel="noopener noreferrer">
            إرسال عبر واتساب
          </a>
          {doc.kind === "invoice" && (
            <>
              <button type="button" className="btn" id="credit-note" onClick={() => go({ name: "new", start: { kind: "credit_note", from: doc.uuid } })}>
                إشعار دائن
              </button>
              <button type="button" className="btn" id="debit-note" onClick={() => go({ name: "new", start: { kind: "debit_note", from: doc.uuid } })}>
                إشعار مدين
              </button>
            </>
          )}
        </div>
      </div>

      {(original || notes.length > 0) && (
        <p className="related">
          {original && (
            <>
              صادر على الفاتورة{" "}
              <button type="button" className="text-btn" onClick={() => go({ name: "doc", uuid: original.uuid })}>
                {original.number}
              </button>
              {doc.input.noteReason && <> · السبب: {doc.input.noteReason}</>}
            </>
          )}
          {notes.length > 0 && (
            <>
              إشعارات على هذه الفاتورة:{" "}
              {notes.map((n) => (
                <button type="button" key={n.uuid} className="text-btn" onClick={() => go({ name: "doc", uuid: n.uuid })}>
                  {n.number}
                </button>
              ))}
            </>
          )}
        </p>
      )}

      <InvoiceDocument doc={doc} />
      <AccountantDetails doc={doc} prev={store.docs[store.docs.indexOf(doc) - 1]} />
    </section>
  );
}

function Qr({ data }: { data: string }) {
  const svg = useMemo(() => {
    const q = qrcode(0, "M");
    q.addData(data, "Byte");
    q.make();
    return q.createSvgTag({ cellSize: 3, margin: 0, scalable: true });
  }, [data]);
  return <div className="qr" role="img" aria-label="رمز الاستجابة السريعة للفاتورة" dangerouslySetInnerHTML={{ __html: svg }} />;
}

export function InvoiceDocument({ doc }: { doc: IssuedDoc }) {
  const [ar, en] = TITLES[`${doc.audience}:${doc.kind}`]!;
  const s = doc.input.seller;
  const b = doc.input.buyer;
  const t = doc.totals;
  const showDiscount = doc.input.lines.some((l) => Number(l.discount ?? 0) > 0);
  const address = (a: { street: string; buildingNumber: string; district: string; city: string; postalCode: string }) =>
    `${a.street}، مبنى ${a.buildingNumber}، حي ${a.district}، ${a.city} ${a.postalCode}`;

  return (
    <article className="document" aria-label={`${ar} ${doc.number}`}>
      <div className="watermark" aria-hidden="true">
        نسخة تجريبية
      </div>

      <header className="doc-head">
        <div className="doc-seller">
          <p className="doc-seller-name">{s.name}</p>
          <p>{address(s.address)}</p>
          <p>
            الرقم الضريبي <span className="ltr">{s.vatNumber}</span>
          </p>
          <p>
            السجل التجاري <span className="ltr">{s.idValue}</span>
          </p>
        </div>
        <div className="doc-title">
          <p className="doc-title-ar">{ar}</p>
          <p className="doc-title-en">{en}</p>
        </div>
      </header>

      <dl className="doc-meta">
        <div>
          <dt>رقم المستند <i>No.</i></dt>
          <dd className="ltr">{doc.number}</dd>
        </div>
        <div>
          <dt>تاريخ الإصدار <i>Issue date</i></dt>
          <dd>
            {gregorian(doc.issueDate)} <span className="faint">{clock(doc.issueTime)}</span>
            <small>{hijri(doc.issueDate)}</small>
          </dd>
        </div>
        {doc.audience === "standard" && (
          <div>
            <dt>تاريخ التوريد <i>Supply date</i></dt>
            <dd>{gregorian(doc.input.supplyDate ?? doc.issueDate)}</dd>
          </div>
        )}
        {doc.input.billingReference ? (
          <div>
            <dt>الفاتورة الأصلية <i>Reference</i></dt>
            <dd className="ltr">{doc.input.billingReference}</dd>
          </div>
        ) : (
          <div>
            <dt>طريقة الدفع <i>Payment</i></dt>
            <dd>{PAYMENT_LABEL[doc.input.paymentMeans ?? ""] ?? "—"}</dd>
          </div>
        )}
      </dl>

      {(b || doc.input.noteReason) && (
        <div className="doc-parties">
          {b && (
            <div>
              <p className="label">
                العميل <i>Customer</i>
              </p>
              <p className="strong">{b.name}</p>
              {b.vatNumber && (
                <p>
                  الرقم الضريبي <span className="ltr">{b.vatNumber}</span>
                </p>
              )}
              {!b.vatNumber && b.idValue && (
                <p>
                  السجل التجاري <span className="ltr">{b.idValue}</span>
                </p>
              )}
              {b.address && <p>{address(b.address)}</p>}
            </div>
          )}
          {doc.input.noteReason && (
            <div>
              <p className="label">
                سبب الإشعار <i>Reason</i>
              </p>
              <p>{doc.input.noteReason}</p>
            </div>
          )}
        </div>
      )}

      <div className="doc-table">
        <table>
          <thead>
            <tr>
              <th className="desc">
                الوصف <i>Description</i>
              </th>
              <th>
                الكمية <i>Qty</i>
              </th>
              <th>
                سعر الوحدة <i>Unit price</i>
              </th>
              {showDiscount && (
                <th>
                  الخصم <i>Discount</i>
                </th>
              )}
              <th className="col-vat">
                الضريبة <i>VAT</i>
              </th>
              <th>
                المجموع شامل الضريبة <i>Total</i>
              </th>
            </tr>
          </thead>
          <tbody>
            {doc.input.lines.map((l, i) => (
              <tr key={i}>
                <td className="desc">{l.name}</td>
                <td className="n">{String(l.quantity)}</td>
                <td className="n">{money(Number(l.unitPrice).toFixed(2))}</td>
                {showDiscount && <td className="n">{Number(l.discount ?? 0) > 0 ? money(Number(l.discount).toFixed(2)) : "—"}</td>}
                <td className="n col-vat">
                  {money(t.lines[i]!.vat)} <span className="faint">{Number(t.lines[i]!.percent)}%</span>
                </td>
                <td className="n">{money(t.lines[i]!.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="doc-foot">
        <div className="doc-qr">
          <Qr data={doc.qr} />
        </div>
        <dl className="doc-totals">
          {Number(t.allowanceTotal) > 0 && (
            <>
              <div>
                <dt>مجموع البنود</dt>
                <dd>{money(t.lineExtension)}</dd>
              </div>
              <div>
                <dt>خصم على الفاتورة</dt>
                <dd>−{money(t.allowanceTotal)}</dd>
              </div>
            </>
          )}
          <div>
            <dt>
              الإجمالي غير شامل الضريبة <i>Total excl. VAT</i>
            </dt>
            <dd>{money(t.taxExclusive)}</dd>
          </div>
          {t.subtotals.map((st) => (
            <div key={`${st.category}${st.percent}${st.reason ?? ""}`}>
              <dt>
                {st.category === "S"
                  ? `ضريبة القيمة المضافة ${Number(st.percent)}%`
                  : `${EXEMPTION_REASONS[st.reason as ExemptionCode]?.ar ?? ""} (${money(st.taxable)})`}
              </dt>
              <dd>{money(st.vat)}</dd>
            </div>
          ))}
          <div className="grand">
            <dt>
              الإجمالي المستحق <i>Amount due</i>
            </dt>
            <dd>
              {money(t.payable)} <span className="cur">ر.س</span>
            </dd>
          </div>
        </dl>
      </div>

      <p className="doc-note">
        {doc.audience === "standard"
          ? "في النسخة الفعلية تُعتمد هذه الفاتورة إلكترونياً قبل تسليمها للعميل."
          : "في النسخة الفعلية تُبلَّغ هذه الفاتورة إلكترونياً خلال 24 ساعة من إصدارها."}{" "}
        نسخة عرض موقّعة بشهادة اختبار عامة، وليست فاتورة ضريبية.
      </p>
    </article>
  );
}

function AccountantDetails({ doc, prev }: { doc: IssuedDoc; prev?: IssuedDoc }) {
  const [copied, setCopied] = useState<"" | "yes" | "no">("");
  const download = CAN_SAVE_FILES
    ? () => {
        const url = URL.createObjectURL(new Blob([doc.xml], { type: "application/xml" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = `${doc.number}.xml`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    : undefined;
  const copy = () =>
    navigator.clipboard.writeText(doc.xml).then(
      () => setCopied("yes"),
      () => setCopied("no"),
    );

  return (
    <details className="accountant">
      <summary>للمحاسب: الملف الإلكتروني وبيانات التحقق</summary>
      <div className="accountant-body">
        <p>
          الملف الإلكتروني (XML بصيغة UBL 2.1) هو النسخة النظامية من الفاتورة، ومنه تُولَّد النسخة المطبوعة. يُحفظ 6 سنوات داخل
          المملكة.
        </p>
        <div className="accountant-actions">
          {download && (
            <button type="button" className="btn" onClick={download}>
              تنزيل ملف XML
            </button>
          )}
          <button type="button" className="btn" onClick={copy}>
            {copied === "yes" ? "نُسخ الملف" : "نسخ ملف XML"}
          </button>
          {copied === "no" && <span className="muted">النسخ غير متاح هنا.</span>}
        </div>
        <dl className="tech">
          <div>
            <dt>المعرّف الفريد</dt>
            <dd className="ltr">{doc.uuid}</dd>
          </div>
          <div>
            <dt>رقم العدّاد</dt>
            <dd className="ltr">{doc.icv}</dd>
          </div>
          <div>
            <dt>بصمة الفاتورة</dt>
            <dd className="ltr">{doc.hash}</dd>
          </div>
          <div>
            <dt>بصمة المستند السابق</dt>
            <dd className="ltr">
              {doc.pih}
              <span className="tech-note">
                {!prev ? "القيمة الابتدائية لأول مستند على الجهاز" : prev.hash === doc.pih ? `مطابقة لبصمة ${prev.number}` : "لا تطابق المستند السابق"}
              </span>
            </dd>
          </div>
        </dl>
      </div>
    </details>
  );
}

