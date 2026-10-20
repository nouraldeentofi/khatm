import type { ReactNode } from "react";
import { clearStore, loadStore, saveStore, seedStore, SELLER, type Store } from "./data.ts";
import { Editor, type EditorStart } from "./views/editor.tsx";
import { InvoicePage } from "./views/invoice.tsx";
import { InvoiceList } from "./views/list.tsx";

const { useEffect, useState } = React;

export type View = { name: "list" } | { name: "new"; start: EditorStart } | { name: "doc"; uuid: string };

/** Turns a rendering error into a readable message and a way back, instead of a blank page. */
export class Boundary extends React.Component<{ onBack: () => void; children: ReactNode }, { error?: Error }> {
  override state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="crash" role="alert">
        <h2>تعذّر عرض هذه الصفحة</h2>
        <p>ارجع إلى قائمة الفواتير وحاول مرة أخرى. إذا تكرر الخطأ، أرسل لنا النص التالي مع اسم المتصفح الذي تستخدمه.</p>
        <pre>
          {error.name}: {error.message}
          {"\n"}
          {navigator.userAgent}
        </pre>
        <div className="actions">
          <button type="button" className="btn primary" onClick={this.props.onBack}>
            العودة إلى الفواتير
          </button>
        </div>
      </div>
    );
  }
}

export function App() {
  const [store, setStore] = useState<Store>(() => loadStore() ?? seedStore());
  const [view, setView] = useState<View>({ name: "list" });
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => saveStore(store), [store]);
  useEffect(() => {
    try {
      window.scrollTo(0, 0);
    } catch {
      // Some embedded viewers refuse programmatic scrolling; staying put is fine.
    }
  }, [view]);

  const reset = () => {
    clearStore();
    setStore(seedStore());
    setView({ name: "list" });
    setConfirmReset(false);
  };

  return (
    <div className="shell">
      <header className="topbar">
        <button type="button" className="brand" onClick={() => setView({ name: "list" })} aria-label="ختم، الصفحة الرئيسية">
          <span className="seal" aria-hidden="true">
            ختم
          </span>
          <span className="brand-name">ختم</span>
        </button>
        <div className="org">
          <span className="org-name">{SELLER.name}</span>
          <span className="org-vat">
            الرقم الضريبي <span className="ltr">{SELLER.vatNumber}</span>
          </span>
        </div>
      </header>
      <p className="demo-note">
        نسخة عرض. الفواتير هنا تُوقَّع بشهادة اختبار عامة، ولا تُرسل إلى أي جهة، وتبقى في متصفحك فقط.
      </p>

      <main className="page">
        <Boundary key={JSON.stringify(view)} onBack={() => setView({ name: "list" })}>
        {view.name === "list" && <InvoiceList store={store} go={setView} />}
        {view.name === "new" && (
          <Editor
            store={store}
            start={view.start}
            onCancel={() => setView(view.start.from ? { name: "doc", uuid: view.start.from } : { name: "list" })}
            onIssued={(next, uuid) => {
              setStore(next);
              setView({ name: "doc", uuid });
            }}
          />
        )}
        {view.name === "doc" && <InvoicePage store={store} uuid={view.uuid} go={setView} />}
        </Boundary>
      </main>

      <footer className="footer">
        <div className="about">
          <p>
            <b>عن هذا العرض.</b> ختم برنامج فواتير إلكترونية للمنشآت في المملكة، يعمل وفق متطلبات المرحلة الثانية (الربط
            والتكامل). هذه الصفحة نسخة عرض تعمل بالكامل داخل متصفحك: لا تطلب تسجيل دخول ولا بيانات دفع، ولا ترسل ما تكتبه إلى أي
            خادم.
          </p>
          <p>
            مشروع مفتوح المصدر من تطوير Nour Aldeen Tofi ·{" "}
            <a href="https://github.com/nouraldeentofi/khatm" target="_blank" rel="noopener noreferrer">
              الكود على GitHub
            </a>{" "}
            ·{" "}
            <a href="https://nouraldeentofi.com" target="_blank" rel="noopener noreferrer">
              nouraldeentofi.com
            </a>
          </p>
        </div>
        {confirmReset ? (
          <span className="inline-confirm">
            ستُحذف الفواتير التي أصدرتها وتعود بيانات العرض.
            <button type="button" className="text-btn danger" onClick={reset}>
              احذف
            </button>
            <button type="button" className="text-btn" onClick={() => setConfirmReset(false)}>
              إلغاء
            </button>
          </span>
        ) : (
          <button type="button" className="text-btn" onClick={() => setConfirmReset(true)}>
            إعادة بيانات العرض
          </button>
        )}
      </footer>
    </div>
  );
}
