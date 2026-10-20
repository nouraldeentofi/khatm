import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalize, parseXml } from "../src/c14n.ts";
import { FIRST_PIH, canonicalInvoice, invoiceHash } from "../src/hash.ts";
import { invoiceDigestValue, sdkSamples } from "./helpers.ts";

describe("invoiceHash", () => {
  it("FIRST_PIH is base64 of the hex SHA-256 of '0'", () => {
    const hex = createHash("sha256").update("0").digest("hex");
    expect(Buffer.from(hex).toString("base64")).toBe(FIRST_PIH);
  });

  for (const sample of sdkSamples()) {
    it(`matches the signed digest in SDK sample ${sample.name}`, () => {
      expect(invoiceHash(sample.xml)).toBe(invoiceDigestValue(sample.xml));
    });
  }
});

describe("canonicalize", () => {
  it("agrees with libxml2 (xmllint --c14n11) on every SDK sample", () => {
    const dir = mkdtempSync(join(tmpdir(), "c14n-"));
    for (const sample of sdkSamples()) {
      const file = join(dir, sample.name);
      writeFileSync(file, sample.xml);
      const reference = execFileSync("xmllint", ["--c14n11", file], { encoding: "utf8" });
      expect(canonicalize(parseXml(sample.xml)), sample.name).toBe(reference);
    }
  });

  it("escapes text and attributes per the spec and sorts attributes", () => {
    const xml = `<a xmlns:z="urn:z" xmlns:b="urn:b" z:k="1" b="x&quot;&#9;y"><c>&lt;&amp;&gt;"'</c><d/></a>`;
    expect(canonicalize(parseXml(xml))).toBe(
      `<a xmlns:b="urn:b" xmlns:z="urn:z" b="x&quot;&#x9;y" z:k="1"><c>&lt;&amp;&gt;"'</c><d></d></a>`,
    );
  });

  it("keeps whitespace left behind by removed elements", () => {
    const xml = `<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2">\n  <cac:Signature/>\n  <cac:X/>\n</Invoice>`;
    expect(canonicalInvoice(xml)).toContain(">\n  \n  <cac:X>");
  });
});
