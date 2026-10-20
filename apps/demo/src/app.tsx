import { clearStore, loadStore, saveStore, seedStore, SELLER, type Store } from "./data.ts";
import { Editor, type EditorStart } from "./views/editor.tsx";
import { InvoicePage } from "./views/invoice.tsx";
import { InvoiceList } from "./views/list.tsx";

const { useEffect, useState } = React;

export type View = { name: "list" } | { name: "new"; start: EditorStart } | { name: "doc"; uuid: string };

export function App() {
  const [store, setStore] = useState<Store>(() => loadStore() ?? seedStore());
  const [view, setView] = useState<View>({ name: "list" });
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => saveStore(store), [store]);
  useEffect(() => window.scrollTo({ top: 0 }), [view]);

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
        نسخة تجريبية للعرض. الفواتير هنا موقّعة بشهادة اختبار من زاتكا ولا تُرسل إليها، وتبقى في متصفحك فقط.
      </p>

      <main className="page">
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
      </main>

      <footer className="footer">
        <span>ختم · فوترة إلكترونية متوافقة مع المرحلة الثانية من زاتكا</span>
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
