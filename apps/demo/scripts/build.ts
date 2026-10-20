// Builds the demo twice:
//   dist/index.html  → one self-contained file, published as an Artifact (the viewer adds the
//                      document skeleton; React comes from cdnjs, the viewer's allow-listed host).
//   dist/site/       → the public site: a small index.html plus readable, unminified-identifier
//                      assets with a source map, so anyone (people or scanners) can see what runs.
import { build, type BuildOptions, type Plugin } from "esbuild";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const root = join(import.meta.dirname, "..");
const src = (f: string) => join(root, "src", f);
const SITE = join(root, "dist", "site");

// zod re-exports every locale (~400 KB); the demo only needs English messages, which the
// page translates itself.
const zodEnglishOnly: Plugin = {
  name: "zod-english-only",
  setup(b) {
    b.onResolve({ filter: /locales\/index\.js$/ }, (args) =>
      args.importer.includes("/zod/") ? { path: join(args.resolveDir, "../locales/index.js"), namespace: "zod-locales" } : undefined,
    );
    b.onLoad({ filter: /.*/, namespace: "zod-locales" }, (args) => ({
      contents: `export { default as en } from "./en.js";`,
      resolveDir: dirname(args.path),
      loader: "js",
    }));
  },
};

const reactFromCdn: Plugin = {
  name: "react-from-cdn",
  setup(b) {
    b.onResolve({ filter: /react-global\.ts$/ }, () => ({ path: src("react-global.cdn.ts") }));
  },
};

const common: BuildOptions = {
  entryPoints: [src("main.tsx")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  jsx: "transform",
  jsxFactory: "React.createElement",
  jsxFragment: "React.Fragment",
  alias: { "node:crypto": src("node-crypto-shim.ts") },
  inject: [src("buffer-global.ts")],
};

const BANNER = `/*!
 * Khatm (ختم) — e-invoicing demo. Open source: https://github.com/nouraldeentofi/khatm
 * Runs entirely in the browser: builds UBL 2.1 invoices, hashes and signs them, and draws
 * the QR code. Nothing typed on the page is sent anywhere.
 * Signing uses the public test certificate and key shipped in the official e-invoicing
 * SDK (Data/Certificates); documents signed with them have no tax validity.
 */`;

const REACT_URL = "https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js";
const REACT_DOM_URL = "https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js";
const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap">`;
const TITLE = "ختم للفوترة";
const DESCRIPTION = "نسخة عرض من ختم، برنامج فواتير إلكترونية للمنشآت في المملكة. مشروع مفتوح المصدر يعمل داخل المتصفح.";

// If nothing has rendered a few seconds after load, say so on the page and show what
// failed, rather than leaving a blank screen.
const BOOT_GUARD = `<script>
(function () {
  var errors = [];
  window.addEventListener("error", function (e) {
    var t = e.target;
    errors.push(t && t.src ? "تعذّر تحميل: " + t.src : (e.message || "خطأ غير معروف"));
  }, true);
  setTimeout(function () {
    var root = document.getElementById("root");
    if (!root || root.childNodes.length) return;
    root.innerHTML = '<div class="crash" role="alert" style="margin:32px auto"><h2>تعذّر تشغيل الصفحة</h2><p>جرّب تحديث الصفحة. إذا استمرت المشكلة، أرسل لنا النص التالي مع اسم المتصفح.</p><pre></pre></div>';
    root.querySelector("pre").textContent = (errors.join("\\n") || "لم يكتمل التحميل") + "\\n" + navigator.userAgent;
  }, 6000);
})();
</script>`;

// ---- Artifact: one file, minified, React from cdnjs, no print or download.
const artifactJs = await build({
  ...common,
  plugins: [zodEnglishOnly, reactFromCdn],
  write: false,
  minify: true,
  legalComments: "none",
  define: { "process.env.NODE_ENV": '"production"', CAN_SAVE_FILES: "false" },
});
const css = readFileSync(src("styles.css"), "utf8");
const artifact = `<title>${TITLE}</title>
<meta name="claude:viewport-fit-sides" content="cover">
<meta name="description" content="${DESCRIPTION}">
${FONTS}
<style>${css}</style>
<div id="root"></div>
<script>document.documentElement.lang = "ar"; document.documentElement.dir = "rtl";</script>
${BOOT_GUARD}
<script src="${REACT_URL}"></script>
<script src="${REACT_DOM_URL}"></script>
<script>${artifactJs.outputFiles[0]!.text.replace(/<\/script/gi, "<\\/script")}</script>
`;
mkdirSync(join(root, "dist"), { recursive: true });
writeFileSync(join(root, "dist", "index.html"), artifact);

// ---- Public site: plain files, React bundled, readable names, source map.
rmSync(SITE, { recursive: true, force: true });
mkdirSync(join(SITE, "assets"), { recursive: true });
await build({
  ...common,
  plugins: [zodEnglishOnly],
  outfile: join(SITE, "assets", "khatm.js"),
  minifyWhitespace: true,
  minifySyntax: true,
  minifyIdentifiers: false,
  sourcemap: "linked",
  banner: { js: BANNER },
  define: { "process.env.NODE_ENV": '"production"', CAN_SAVE_FILES: "true" },
});
copyFileSync(src("styles.css"), join(SITE, "assets", "khatm.css"));
const verification = process.env.GOOGLE_SITE_VERIFICATION
  ? `\n<meta name="google-site-verification" content="${process.env.GOOGLE_SITE_VERIFICATION}">`
  : "";
const site = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0d5c3f">
<title>${TITLE}</title>
<meta name="description" content="${DESCRIPTION}">
<meta name="author" content="Nour Aldeen Tofi">${verification}
<link rel="author" href="https://nouraldeentofi.com">
${FONTS}
<link rel="stylesheet" href="assets/khatm.css">
</head>
<body>
<div id="root"></div>
${BOOT_GUARD}
<script src="assets/khatm.js" defer></script>
<noscript>هذه الصفحة تحتاج JavaScript. الكود المصدري: https://github.com/nouraldeentofi/khatm</noscript>
</body>
</html>
`;
writeFileSync(join(SITE, "index.html"), site);
writeFileSync(join(SITE, ".nojekyll"), "");

const kb = (f: string) => `${(readFileSync(f).length / 1024).toFixed(0)} KB`;
console.log(
  `dist/index.html ${kb(join(root, "dist", "index.html"))} · site: index.html ${kb(join(SITE, "index.html"))}, khatm.js ${kb(join(SITE, "assets", "khatm.js"))}`,
);
