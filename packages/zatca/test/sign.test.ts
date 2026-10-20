import { createVerify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseCertificate } from "../src/cert.ts";
import { invoiceHash } from "../src/hash.ts";
import { decodeQr } from "../src/qr.ts";
import { signInvoice } from "../src/sign.ts";
import { qrOf, sdkSamples, sdkTestCredentials, tagValue } from "./helpers.ts";
import { sdkAvailable, sdkValidate } from "./sdk.ts";

const creds = sdkTestCredentials();
const sample = sdkSamples().find((s) => s.name === "Simplified-Invoice--Simplified_Invoice.xml")!;
// 2025-07-22T15:51:28 Riyadh — the SigningTime in the SDK sample.
const sampleSigningTime = new Date("2025-07-22T12:51:28Z");

describe("parseCertificate", () => {
  it("extracts the issuer, serial and digest the SDK sample uses", () => {
    const cert = parseCertificate(creds.certificate);
    expect(cert.issuerName).toBe("CN=PRZEINVOICESCA4-CA, DC=extgazt, DC=gov, DC=local");
    expect(cert.serialNumber).toBe(tagValue(sample.xml, "ds:X509SerialNumber"));
    expect(sample.xml).toContain(`<ds:DigestValue>${cert.hash}</ds:DigestValue>`);
  });

  it("accepts ZATCA's binarySecurityToken (base64 of base64)", () => {
    const token = Buffer.from(creds.certificate).toString("base64");
    expect(parseCertificate(token).base64).toBe(creds.certificate);
  });
});

describe("signInvoice", () => {
  const signed = signInvoice(sample.xml, creds, { signingTime: sampleSigningTime });

  it("keeps the invoice hash and reproduces the sample's SignedProperties digest", () => {
    expect(signed.hash).toBe(invoiceHash(sample.xml));
    const spDigest = (xml: string) =>
      xml.match(/URI="#xadesSignedProperties">[\s\S]*?<ds:DigestValue>([^<]+)/)![1];
    expect(spDigest(signed.xml)).toBe(spDigest(sample.xml));
  });

  it("produces an ECDSA signature over the hash bytes that verifies with the certificate", () => {
    const cert = parseCertificate(creds.certificate);
    const ok = createVerify("sha256")
      .update(Buffer.from(signed.hash, "base64"))
      .verify({ key: cert.publicKeyDer, format: "der", type: "spki" }, Buffer.from(signed.signature, "base64"));
    expect(ok).toBe(true);
  });

  it("builds the same QR as the SDK except for the (randomised) signature", () => {
    const ours = decodeQr(signed.qr);
    const theirs = decodeQr(qrOf(sample.xml));
    for (const tag of [1, 2, 3, 4, 5, 6, 8, 9]) expect(ours.get(tag), `tag ${tag}`).toEqual(theirs.get(tag));
  });
});

describe("QR tag 4", () => {
  for (const name of [
    "Standard-Invoice--Advance_Payment_adjustments.xml",
    "Standard-Invoice--Standard_Invoice_with_Payable_Rounding_Adjustment.xml",
  ]) {
    it(`uses the amount due, as the SDK does, in ${name}`, () => {
      const s = sdkSamples().find((x) => x.name === name)!;
      const ours = decodeQr(signInvoice(s.xml, creds).qr).get(4)!.toString();
      expect(ours).toBe(decodeQr(qrOf(s.xml)).get(4)!.toString());
    });
  }
});

describe.runIf(sdkAvailable)("official SDK accepts our signatures", () => {
  for (const s of sdkSamples()) {
    it(`re-signed ${s.name}`, async () => {
      const { xml } = signInvoice(s.xml, creds);
      const result = await sdkValidate(xml, s.name);
      expect(result.errors).toEqual([]);
      expect(result.passed).toBe(true);
    }, 60_000);
  }
});
