// Drives the built page in Chromium the way a person would, then hands every document it
// issued to ZATCA's official SDK validator. Run after `pnpm build`.
//   CHROMIUM=/path/to/chrome pnpm --filter @khatm/demo test
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "playwright-core";
import { sdkAvailable, sdkValidate } from "../../../packages/zatca/test/sdk.ts";
import type { IssuedDoc } from "../src/engine.ts";

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

await page.goto(`file://${join(root, "dist", "standalone.html")}`);
await page.getByRole("tab", { name: "الفاتورة" }).waitFor();
check((await page.locator(".chain li").count()) === 1, "opens with one sample document issued");
check((await page.locator(".paper .qr svg").count()) === 1, "sample invoice shows a QR code");
if (shots) await page.screenshot({ path: join(shots, "desktop.png"), fullPage: true });

const choose = (name: string) => page.locator(".segmented label", { hasText: name }).first().click();
const issueDoc = async () => {
  const before = await page.locator(".chain li").count();
  await page.locator("#issue").click();
  await page.waitForFunction((n) => document.querySelectorAll(".chain li").length === n + 1, before);
};

await choose("مبسطة");
await issueDoc();
await choose("إشعار دائن");
await issueDoc();
await choose("ضريبية");
await issueDoc();
await choose("إشعار مدين");
await issueDoc();
await choose("مبسطة");
await issueDoc();

// A tax invoice without any buyer identifier must be stopped, in Arabic.
await choose("فاتورة");
await choose("ضريبية");
await page.locator("#buyer-vat").fill("");
await page.locator("#issue").click();
const errorText = await page.locator(".problems.loud").innerText();
check(errorText.includes("أدخل الرقم الضريبي للمشتري أو رقم سجله التجاري"), "blocks a tax invoice with no buyer ID, in Arabic");
check((await page.locator(".chain li").count()) === 6, "a blocked document takes no counter value");

await page.locator("#tab-zatca").click();
check((await page.locator(".check.ok").count()) === 1, "'What ZATCA sees' confirms the PIH link");

const docs = JSON.parse((await page.evaluate(() => localStorage.getItem("khatm-demo-chain-v1"))) ?? "[]") as IssuedDoc[];
const kinds = docs.map((d) => `${d.audience}:${d.kind}`);
check(
  JSON.stringify(kinds) ===
    JSON.stringify(["standard:invoice", "simplified:invoice", "simplified:credit_note", "standard:credit_note", "standard:debit_note", "simplified:debit_note"]),
  `covers the six compliance document types (${kinds.join(", ")})`,
);
check(docs.every((d, i) => d.icv === i + 1), "ICV runs 1..6");
check(docs.every((d, i) => i === 0 || d.pih === docs[i - 1]!.hash), "each PIH is the previous document's hash");

if (sdkAvailable) {
  for (const d of docs) {
    const r = await sdkValidate(d.xml, `${d.number}.xml`, { pih: d.pih });
    check(r.passed && r.errors.length === 0, `SDK accepts ${d.number} (${d.audience} ${d.kind})${r.errors.length ? `: ${r.errors.join("; ")}` : ""}`);
  }
} else {
  console.log("- SDK not installed; skipped official validation");
}

if (shots) {
  await page.locator("#tab-doc").click();
  await screenshotPhone(page);
}

check(consoleErrors.length === 0, `no console errors${consoleErrors.length ? `: ${consoleErrors.join(" | ")}` : ""}`);
await browser.close();
process.exit(failures ? 1 : 0);

async function screenshotPhone(p: Page) {
  await p.setViewportSize({ width: 390, height: 844 });
  await p.emulateMedia({ colorScheme: "dark" });
  await p.screenshot({ path: join(shots!, "phone-dark.png"), fullPage: true });
}
