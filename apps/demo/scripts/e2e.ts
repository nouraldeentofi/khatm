// Uses the built site in Chromium the way a customer would, then hands every document
// it issued to ZATCA's official SDK validator. Run after the build:
//   pnpm --filter @khatm/demo e2e        (CHROMIUM=/path/to/chrome to override)
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { sdkAvailable, sdkValidate } from "../../../packages/zatca/test/sdk.ts";
import type { Store } from "../src/data.ts";

const root = join(import.meta.dirname, "..");
const shots = process.env.SHOTS_DIR;
let failures = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "✓" : "✗"} ${what}`);
  if (!ok) failures++;
};

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
const consoleErrors: string[] = [];
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
page.on("pageerror", (e) => consoleErrors.push(e.message));

// Serve the CDN scripts from node_modules (same versions) and skip web fonts.
await page.route("https://cdnjs.cloudflare.com/**", (route) => {
  const file = route.request().url().includes("react-dom")
    ? join(root, "node_modules/react-dom/umd/react-dom.production.min.js")
    : join(root, "node_modules/react/umd/react.production.min.js");
  return route.fulfill({ contentType: "text/javascript", body: readFileSync(file, "utf8") });
});
await page.route("https://fonts.googleapis.com/**", (route) => route.fulfill({ contentType: "text/css", body: "" }));

const shot = async (name: string) => shots && page.screenshot({ path: join(shots, `${name}.png`), fullPage: true });
const rows = () => page.locator("button.row").count();
const store = async () => JSON.parse((await page.evaluate(() => localStorage.getItem("khatm-demo-v2"))) ?? "{}") as Store;
const toList = async () => {
  await page.locator(".brand").click();
  await page.locator("#new-invoice").waitFor();
};
const fillItem = async (i: number, name: string, qty: string, price: string) => {
  await page.locator(`#item-${i}-name`).fill(name);
  await page.locator(`#item-${i}-qty`).fill(qty);
  await page.locator(`#item-${i}-price`).fill(price);
};
const issueAndOpen = async () => {
  await page.locator("#issue").click();
  await page.locator("article.document").waitFor();
};

await page.goto(`file://${join(root, "dist", "site", "index.html")}`);
await page.locator("#new-invoice").waitFor();
check((await rows()) === 6, "opens on the invoice list with a week of example documents");
await shot("1-list");

await page.locator(".filters button", { hasText: "مؤسسة نجد" }).click();
check((await rows()) === 2, "filtering by customer shows that customer's invoice and credit note");
await page.locator(".filters button", { hasText: "الكل" }).click();

// Tax invoice to an existing business customer.
await page.locator("#new-invoice").click();
await fillItem(0, "لوحة تحكم إنذار حريق 8 مناطق", "1", "4200");
await page.locator("#add-item").click();
await fillItem(1, "كاشف حرارة", "10", "48.5");
await shot("2-editor");
await issueAndOpen();
check((await page.locator("h1").innerText()).includes("فاتورة ضريبية"), "issues a tax invoice and opens it");
check((await page.locator(".doc-totals .grand").innerText()).includes("5,387.75"), "invoice total is 4,685.00 + 15% VAT = 5,387.75");
check(await page.getByRole("button", { name: "طباعة أو حفظ PDF" }).isVisible(), "offers print / save as PDF on the public site");
await shot("3-invoice");

// Simplified invoice to a walk-in customer, then a credit note on it.
await toList();
await page.locator("#new-invoice").click();
await page.locator("label[class] >> text=فرد").click();
await fillItem(0, "طفاية ثاني أكسيد الكربون 5 كغ", "2", "210");
await issueAndOpen();
check((await page.locator("h1").innerText()).includes("فاتورة ضريبية مبسطة"), "issues a simplified invoice for an individual");
await page.locator("#credit-note").click();
await page.locator(".reasons button", { hasText: "إرجاع بضاعة" }).click();
await issueAndOpen();
check((await page.locator("h1").innerText()).includes("إشعار دائن"), "issues a credit note from the invoice page");
await page.locator(".related .text-btn").first().click();
await page.locator("#debit-note").click();
await fillItem(0, "رسوم توصيل", "1", "25");
await page.locator(".reasons button", { hasText: "رسوم توصيل" }).click();
await issueAndOpen();
check((await page.locator("h1").innerText()).includes("إشعار مدين"), "issues a debit note on the simplified invoice via its credit note's link");

// Debit note on another business customer's invoice.
await toList();
await page.locator("button.row", { hasText: "شركة الخليج" }).first().click();
await page.locator("#debit-note").click();
await fillItem(0, "فرق سعر صمامات", "1", "120");
await page.locator(".reasons button", { hasText: "فرق سعر" }).click();
await issueAndOpen();
check((await page.locator("h1").innerText()).includes("إشعار مدين"), "issues a debit note");

// A new business customer: incomplete details are stopped in Arabic, complete ones go through.
await toList();
const before = await rows();
await page.locator("#new-invoice").click();
await page.locator("#customer").selectOption("__new");
await page.locator("#new-name").fill("شركة الريادة للتجارة");
await fillItem(0, "توريد معدات", "1", "900");
await page.locator("#issue").click();
const problems = await page.locator(".problems").innerText();
check(
  problems.includes("أدخل الرقم الضريبي للعميل أو رقم سجله التجاري") && problems.includes("أكمل العنوان الوطني للعميل: الشارع، رقم المبنى، الحي، المدينة، الرمز البريدي"),
  "stops a tax invoice with no customer ID or address, in Arabic",
);
await page.locator("#new-cr").fill("1010987654");
await page.locator("#new-street").fill("طريق الملك عبدالعزيز");
await page.locator("#new-building").fill("6621");
await page.locator("#new-district").fill("الملقا");
await page.locator("#new-city").fill("الرياض");
await page.locator("#new-postal").fill("13521");
await issueAndOpen();
await page.locator(".accountant summary").click();
check((await page.locator(".tech-note").innerText()).startsWith("مطابقة"), "accountant details confirm the chain link");
await toList();
check((await rows()) === before + 1, "a blocked attempt takes no number; the corrected one does");
check((await page.locator(".filters button", { hasText: "شركة الريادة" }).count()) === 1, "the new customer gets its own filter");

const s = await store();
check(s.docs.every((d, i) => d.icv === i + 1), `ICV runs 1..${s.docs.length} with no gaps`);
check(s.docs.every((d, i) => i === 0 || d.pih === s.docs[i - 1]!.hash), "each document carries the previous one's hash");
const kinds = new Set(s.docs.map((d) => `${d.audience}:${d.kind}`));
check(kinds.size === 6, `covers all six compliance document types (${[...kinds].join(", ")})`);

if (sdkAvailable) {
  for (const d of s.docs) {
    const r = await sdkValidate(d.xml, `${d.number}.xml`, { pih: d.pih });
    check(r.passed && r.errors.length === 0, `SDK accepts ${d.number} (${d.audience} ${d.kind})${r.errors.length ? `: ${r.errors.join("; ")}` : ""}`);
  }
} else {
  console.log("- SDK not installed; skipped official validation");
}

if (shots) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "dark" });
  await shot("4-list-phone-dark");
  await page.locator("button.row").first().click();
  await page.locator("article.document").waitFor();
  await shot("5-invoice-phone-dark");
}

check(consoleErrors.length === 0, `no console errors${consoleErrors.length ? `: ${consoleErrors.join(" | ")}` : ""}`);

// A screen that throws shows the error and a way back instead of a blank page.
await page.setViewportSize({ width: 1360, height: 900 });
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem("khatm-demo-v2")!);
  s.docs[0].totals.lines = []; // the invoice table reads totals for each line
  localStorage.setItem("khatm-demo-v2", JSON.stringify(s));
});
await page.reload();
await page.locator("button.row").last().click();
check(await page.locator(".crash").isVisible(), "a broken screen shows an error message, not a blank page");
await page.locator(".crash .btn").click();
check(await page.locator("#new-invoice").isVisible(), "the error message leads back to the list");

// Saved data in an outdated shape is discarded, not rendered.
await page.evaluate(() => localStorage.setItem("khatm-demo-v2", JSON.stringify({ docs: [{ number: "x" }] })));
await page.reload();
check((await rows()) === 6, "outdated saved data is replaced by fresh example data");

// If the app cannot start (here: the Artifact build with its CDN blocked), the page says so.
const blocked = await browser.newPage();
await blocked.route("https://cdnjs.cloudflare.com/**", (r) => r.abort());
await blocked.route("https://fonts.googleapis.com/**", (r) => r.abort());
await blocked.goto(`file://${join(root, "dist", "index.html")}`);
await blocked.waitForTimeout(6500);
const bootText = (await blocked.locator(".crash pre").textContent()) ?? "";
check(bootText.includes("تعذّر تحميل") && bootText.includes("cdnjs"), "a page that cannot start explains why instead of staying blank");
await blocked.close();
await browser.close();
process.exit(failures ? 1 : 0);
