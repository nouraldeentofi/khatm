// Inclusive XML canonicalization (C14N 1.1, without comments) for whole documents.
// For ZATCA invoices — no xml:* attributes, no document subsets — C14N 1.0 and 1.1
// produce identical output, so one implementation covers both.
import { DOMParser, type Document, type Element, type Node } from "@xmldom/xmldom";

const ELEMENT = 1;
const TEXT = 3;
const CDATA = 4;
const PI = 7;
const COMMENT = 8;
const DOCUMENT = 9;

export function parseXml(xml: string): Document {
  // XML parsers must normalize line endings; do it up front so text nodes match the spec.
  const normalized = xml.replace(/\r\n?/g, "\n");
  const errors: string[] = [];
  const doc = new DOMParser({
    onError: (level, message) => {
      if (level !== "warning") errors.push(message);
    },
  }).parseFromString(normalized, "text/xml");
  if (errors.length > 0 || !doc.documentElement) {
    throw new Error(`Invalid XML: ${errors[0] ?? "no document element"}`);
  }
  return doc;
}

export function canonicalize(node: Document | Element): string {
  if (node.nodeType === DOCUMENT) {
    const doc = node as Document;
    let out = "";
    let seenRoot = false;
    for (let child = doc.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === ELEMENT) {
        if (seenRoot) out += "\n";
        out += element(child as Element, new Map());
        seenRoot = true;
      } else if (child.nodeType === PI && child.nodeName !== "xml") {
        // xmldom surfaces the XML declaration as a PI named "xml"; C14N drops it.
        // PIs outside the root are separated from it by a single newline.
        out += seenRoot ? `\n${pi(child)}` : `${pi(child)}\n`;
      }
    }
    return out;
  }
  return element(node as Element, new Map());
}

function element(el: Element, renderedNs: Map<string, string>): string {
  const scope = new Map(renderedNs);
  const nsDecls: Array<[string, string]> = [];
  const attrs: Array<{ ns: string; local: string; name: string; value: string }> = [];

  for (let i = 0; i < el.attributes.length; i++) {
    const attr = el.attributes.item(i)!;
    if (attr.name === "xmlns" || attr.name.startsWith("xmlns:")) {
      const prefix = attr.name === "xmlns" ? "" : attr.name.slice(6);
      const inherited = scope.get(prefix) ?? "";
      if (inherited !== attr.value) {
        nsDecls.push([prefix, attr.value]);
        scope.set(prefix, attr.value);
      }
    } else {
      attrs.push({
        ns: attr.namespaceURI ?? "",
        local: attr.localName ?? attr.name,
        name: attr.name,
        value: attr.value,
      });
    }
  }

  nsDecls.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  attrs.sort((a, b) => (a.ns === b.ns ? cmp(a.local, b.local) : cmp(a.ns, b.ns)));

  let out = `<${el.tagName}`;
  for (const [prefix, uri] of nsDecls) {
    out += prefix ? ` xmlns:${prefix}="${escapeAttr(uri)}"` : ` xmlns="${escapeAttr(uri)}"`;
  }
  for (const a of attrs) out += ` ${a.name}="${escapeAttr(a.value)}"`;
  out += ">";

  for (let child: Node | null = el.firstChild; child; child = child.nextSibling) {
    switch (child.nodeType) {
      case ELEMENT:
        out += element(child as Element, scope);
        break;
      case TEXT:
      case CDATA:
        out += escapeText(child.nodeValue ?? "");
        break;
      case PI:
        out += pi(child);
        break;
      case COMMENT:
        break;
    }
  }
  return `${out}</${el.tagName}>`;
}

function pi(node: Node): string {
  const data = node.nodeValue ?? "";
  return data ? `<?${node.nodeName} ${data}?>` : `<?${node.nodeName}?>`;
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\r/g, "&#xD;");
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;")
    .replace(/\t/g, "&#x9;")
    .replace(/\n/g, "&#xA;")
    .replace(/\r/g, "&#xD;");
}
