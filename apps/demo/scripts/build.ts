// Bundles the demo into one self-contained page: dist/index.html (published as an
// Artifact, which supplies the document skeleton) and dist/standalone.html (a full
// document for local use and the e2e test).
import { build, type Plugin } from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const root = join(import.meta.dirname, "..");
const src = (f: string) => join(root, "src", f);

// zod re-exports every locale (~400 KB); the demo only needs English messages,
// which the page translates itself.
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

const result = await build({
  entryPoints: [src("main.tsx")],
  plugins: [zodEnglishOnly],
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  target: "es2022",
  minify: true,
  legalComments: "none",
  jsx: "transform",
  jsxFactory: "React.createElement",
  jsxFragment: "React.Fragment",
  alias: { "node:crypto": src("node-crypto-shim.ts") },
  inject: [src("buffer-global.ts")],
  define: { "process.env.NODE_ENV": '"production"' },
});
const js = result.outputFiles[0]!.text.replace(/<\/script/gi, "<\\/script");
const css = readFileSync(src("styles.css"), "utf8");

export const REACT_URL = "https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js";
export const REACT_DOM_URL = "https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js";

const page = `<title>ختم للفوترة</title>
<meta name="claude:viewport-fit-sides" content="cover">
<meta name="description" content="نسخة تجريبية من محرّك ختم للفوترة الإلكترونية المتوافقة مع المرحلة الثانية من زاتكا">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap">
<style>${css}</style>
<div id="root"></div>
<script>document.documentElement.lang = "ar"; document.documentElement.dir = "rtl";</script>
<script src="${REACT_URL}"></script>
<script src="${REACT_DOM_URL}"></script>
<script>${js}</script>
`;

mkdirSync(join(root, "dist"), { recursive: true });
writeFileSync(join(root, "dist", "index.html"), page);
writeFileSync(
  join(root, "dist", "standalone.html"),
  `<!doctype html>\n<html lang="ar" dir="rtl">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n</head>\n<body>\n${page}</body>\n</html>\n`,
);
console.log(`dist/index.html ${(Buffer.byteLength(page) / 1024).toFixed(0)} KB (script ${(js.length / 1024).toFixed(0)} KB)`);
